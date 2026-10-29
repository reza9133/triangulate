"""
A minimal, in-process stand-in for the GenVM runtime.

Purpose
-------
The contract in ``contracts/triangulate.py`` is executed here *unmodified*. The simulator
provides just enough of the ``genlayer`` SDK surface for that to work, and it enforces the
runtime rules that shape the contract's design:

* ``gl.nondet.*`` may only be called inside a non-deterministic block.
* Contract storage may not be touched inside a non-deterministic block.
* ``gl.vm.run_nondet_unsafe`` runs the leader, then every validator function against the
  leader's result, and only returns if a strict majority agrees.
* A transaction that raises rolls all of its storage writes back.

What this is NOT
----------------
It is not GenVM. It does not model gas, calldata encoding, WebAssembly isolation, real LLMs
or real HTTP. It verifies contract *logic*. Linting with ``genvm-lint``, running the gltest
direct-mode suite, and a live deploy remain the acceptance tests for the real runtime.
"""

from __future__ import annotations

import copy
import json
import sys
import types
from typing import Any, Callable, Dict, List, Optional


class UserError(Exception):
    """Mirror of gl.vm.UserError."""

    def __init__(self, message: str = '') -> None:
        super().__init__(message)
        self.message = message


class Return:
    """Mirror of gl.vm.Return: the leader's successful result."""

    def __init__(self, calldata: Any) -> None:
        self.calldata = calldata


class NoConsensus(Exception):
    """Raised when validators reject the leader. On a real network this rotates the leader."""


class SimulationRuleViolation(RuntimeError):
    """Raised when the contract breaks a GenVM rule the simulator enforces."""


class Env:
    """What one node can see: its own view of the web and its own model."""

    def __init__(self, web: Optional[Dict[str, Any]] = None, llm: Optional[Callable[[str], Any]] = None) -> None:
        self.web: Dict[str, Any] = web if web is not None else {}
        self.llm = llm


class _Runtime:
    def __init__(self) -> None:
        self.in_nondet = False
        self.env: Env = Env()
        self.validator_envs: List[Env] = []
        self.prompts: List[str] = []
        self.requests: List[str] = []
        self.blocks_run = 0
        self.rounds: List[List[bool]] = []

    def reset(self) -> None:
        self.__init__()


RUNTIME = _Runtime()


def _guard_storage() -> None:
    if RUNTIME.in_nondet:
        raise SimulationRuleViolation('contract storage was accessed inside a non-deterministic block')


def _guard_nondet() -> None:
    if not RUNTIME.in_nondet:
        raise SimulationRuleViolation('gl.nondet was called outside a non-deterministic block')


class TreeMap(dict):
    """Storage map. Behaves like a dict but refuses access inside a non-deterministic block."""

    def __class_getitem__(cls, item: Any) -> type:
        return cls

    def __getitem__(self, key: Any) -> Any:
        _guard_storage()
        return super().__getitem__(key)

    def __setitem__(self, key: Any, value: Any) -> None:
        _guard_storage()
        super().__setitem__(key, value)

    def __contains__(self, key: object) -> bool:
        _guard_storage()
        return super().__contains__(key)

    def get(self, key: Any, default: Any = None) -> Any:
        _guard_storage()
        return super().get(key, default)


class DynArray(list):
    def __class_getitem__(cls, item: Any) -> type:
        return cls


class Address:
    def __init__(self, value: str) -> None:
        raw = value.lower().removeprefix('0x')
        if len(raw) != 40:
            raise ValueError('address must be 20 bytes')
        self._hex = '0x' + raw

    @property
    def as_hex(self) -> str:
        return self._hex

    def __eq__(self, other: object) -> bool:
        return isinstance(other, Address) and other._hex == self._hex

    def __hash__(self) -> int:
        return hash(self._hex)

    def __repr__(self) -> str:
        return 'Address(%s)' % self._hex


class Message:
    def __init__(self, sender: Address, contract: Address, value: int = 0) -> None:
        self.sender_address = sender
        self.origin_address = sender
        self.contract_address = contract
        self.value = value
        self.chain_id = 61999


class Response:
    def __init__(self, status: int, body: bytes) -> None:
        self.status = status
        self.headers: Dict[str, bytes] = {}
        self.body = body


def _web_get(url: str, **_: Any) -> Response:
    _guard_nondet()
    RUNTIME.requests.append(url)
    entry = RUNTIME.env.web.get(url)
    if entry is None:
        raise ConnectionError('no route to ' + url)
    if callable(entry):
        entry = entry()
    if isinstance(entry, BaseException) or (isinstance(entry, type) and issubclass(entry, BaseException)):
        raise entry if isinstance(entry, BaseException) else entry()
    status, body = entry
    if isinstance(body, str):
        body = body.encode('utf-8')
    return Response(status, body)


def _exec_prompt(prompt: str, *, response_format: Optional[str] = None, images: Any = None) -> Any:
    _guard_nondet()
    RUNTIME.prompts.append(prompt)
    llm = RUNTIME.env.llm
    if llm is None:
        raise RuntimeError('no model configured in the simulator environment')
    result = llm(prompt)
    if isinstance(result, BaseException):
        raise result
    if response_format == 'json' and isinstance(result, str):
        return json.loads(result)
    return result


def _run_nondet_unsafe(leader_fn: Callable[[], Any], validator_fn: Callable[[Any], bool]) -> Any:
    if RUNTIME.in_nondet:
        raise SimulationRuleViolation('nested non-deterministic blocks are not allowed')
    RUNTIME.blocks_run += 1
    leader_env = RUNTIME.env
    RUNTIME.in_nondet = True
    try:
        try:
            leader_result: Any = Return(leader_fn())
        except Exception as error:
            # A crashing leader hands validators an error result instead of a Return.
            leader_result = error
        votes = [isinstance(leader_result, Return)]
        for validator_env in RUNTIME.validator_envs:
            RUNTIME.env = validator_env
            try:
                votes.append(bool(validator_fn(leader_result)))
            except Exception:
                votes.append(False)
    finally:
        RUNTIME.env = leader_env
        RUNTIME.in_nondet = False
    RUNTIME.rounds.append(votes)
    if sum(1 for vote in votes if vote) * 2 > len(votes):
        assert isinstance(leader_result, Return)
        return leader_result.calldata
    raise NoConsensus('validators rejected the leader result: %r' % (votes,))


def _default_for(annotation: Any) -> Any:
    if isinstance(annotation, type):
        if issubclass(annotation, TreeMap):
            return annotation()
        if issubclass(annotation, DynArray):
            return annotation()
        if annotation is int:
            return 0
        if annotation is str:
            return ''
        if annotation is bool:
            return False
    return None


class Contract:
    """Base class. Zero-initialises every annotated field, like GenVM does."""

    def __new__(cls, *args: Any, **kwargs: Any) -> 'Contract':
        instance = super().__new__(cls)
        for klass in reversed(cls.__mro__):
            for name, annotation in getattr(klass, '__annotations__', {}).items():
                if name not in instance.__dict__:
                    setattr(instance, name, _default_for(annotation))
        return instance


def _view(function: Callable[..., Any]) -> Callable[..., Any]:
    function._gl_kind = 'view'  # type: ignore[attr-defined]
    return function


class _Write:
    def __call__(self, function: Callable[..., Any]) -> Callable[..., Any]:
        function._gl_kind = 'write'  # type: ignore[attr-defined]
        return function

    def payable(self, function: Callable[..., Any]) -> Callable[..., Any]:
        function._gl_kind = 'write'  # type: ignore[attr-defined]
        return function


def _allow_storage(cls: type) -> type:
    return cls


def build_gl() -> types.SimpleNamespace:
    zero = Address('0x' + '00' * 20)
    return types.SimpleNamespace(
        Contract=Contract,
        public=types.SimpleNamespace(view=_view, write=_Write()),
        message=Message(zero, zero),
        message_raw={'datetime': '2026-01-01T00:00:00.000000Z'},
        vm=types.SimpleNamespace(
            UserError=UserError,
            Return=Return,
            run_nondet_unsafe=_run_nondet_unsafe,
        ),
        nondet=types.SimpleNamespace(
            web=types.SimpleNamespace(get=_web_get),
            exec_prompt=_exec_prompt,
        ),
    )


GL = build_gl()


def install() -> types.ModuleType:
    """Register a fake ``genlayer`` module so ``from genlayer import *`` works."""
    module = types.ModuleType('genlayer')
    exported: Dict[str, Any] = {
        'gl': GL,
        'Address': Address,
        'TreeMap': TreeMap,
        'DynArray': DynArray,
        'allow_storage': _allow_storage,
        'u8': int,
        'u32': int,
        'u64': int,
        'u256': int,
        'i32': int,
        'i64': int,
        'bigint': int,
    }
    for name, value in exported.items():
        setattr(module, name, value)
    module.__all__ = list(exported)  # type: ignore[attr-defined]
    sys.modules['genlayer'] = module
    return module


def snapshot(instance: Any) -> Dict[str, Any]:
    return copy.deepcopy(instance.__dict__)


def restore(instance: Any, state: Dict[str, Any]) -> None:
    instance.__dict__.clear()
    instance.__dict__.update(state)
