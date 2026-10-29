"""Static checks that catch GenVM-specific mistakes and repository rules before deployment."""

import ast
import hashlib
import json
import os
import re
import subprocess
import sys
import unittest
from pathlib import Path

from support import CONTRACT_PATH, ROOT, load_contract_module

SOURCE = CONTRACT_PATH.read_text(encoding='utf-8')
TREE = ast.parse(SOURCE)
RUNNER = 'py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6'
FORBIDDEN_IMPORTS = {'os', 'sys', 'time', 'random', 'datetime', 'subprocess', 'socket', 'threading', 'requests', 'urllib'}
ARABIC_SCRIPT = re.compile('[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]')
SKIP_DIRS = {'node_modules', '.git', 'dist', '__pycache__', '.venv', 'artifacts'}
TEXT_SUFFIXES = {'.py', '.js', '.mjs', '.json', '.md', '.html', '.toml', '.yml', '.yaml', '.txt', '.example', '.sh', ''}


class ContractSourceTests(unittest.TestCase):
    def test_first_line_pins_the_stable_studionet_runner(self):
        self.assertEqual(SOURCE.splitlines()[0], '# { "Depends": "%s" }' % RUNNER)

    def test_runner_constant_matches_the_header(self):
        self.assertEqual(load_contract_module().RUNNER, RUNNER)

    def test_no_forbidden_imports(self):
        imported = set()
        for node in ast.walk(TREE):
            if isinstance(node, ast.Import):
                imported.update(alias.name.split('.')[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                imported.add(node.module.split('.')[0])
        self.assertEqual(imported & FORBIDDEN_IMPORTS, set())
        self.assertEqual(imported, {'genlayer', 'hashlib', 'json', 're', 'typing'})

    def test_no_floats_and_no_true_division(self):
        for node in ast.walk(TREE):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
                self.assertNotEqual(node.func.id, 'float')
            if isinstance(node, ast.Constant):
                self.assertNotIsInstance(node.value, float)
            if isinstance(node, ast.BinOp):
                self.assertNotIsInstance(node.op, ast.Div, 'true division produces a float')

    def test_sized_integer_types_are_annotations_only(self):
        for node in ast.walk(TREE):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
                self.assertNotRegex(node.func.id, r'^[ui]\d+$', 'sized integers are not callable on every runtime')

    def test_builtin_hash_and_id_are_never_used(self):
        for node in ast.walk(TREE):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
                self.assertNotIn(node.func.id, ('hash', 'id', 'input', 'open', 'eval', 'exec', 'print', 'globals'))

    def test_nondeterministic_apis_are_confined_to_the_fetch_and_model_helpers(self):
        allowed = {'_fetch_page', '_examine_once'}
        offenders = []
        for function in [n for n in TREE.body if isinstance(n, ast.FunctionDef)]:
            for node in ast.walk(function):
                if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Attribute):
                    chain = ast.unparse(node)
                    if chain.startswith('gl.nondet') and function.name not in allowed:
                        offenders.append((function.name, chain))
        self.assertEqual(offenders, [])

    def test_only_the_examination_wrapper_calls_the_vm(self):
        owners = set()
        for function in [n for n in TREE.body if isinstance(n, ast.FunctionDef)]:
            for node in ast.walk(function):
                if isinstance(node, ast.Call) and ast.unparse(node.func) == 'gl.vm.run_nondet_unsafe':
                    owners.add(function.name)
        self.assertEqual(owners, {'_run_examination'})

    def test_contract_methods_never_touch_the_network_or_the_model(self):
        contract = next(n for n in TREE.body if isinstance(n, ast.ClassDef))
        for node in ast.walk(contract):
            if isinstance(node, ast.Attribute):
                self.assertFalse(ast.unparse(node).startswith('gl.nondet'))

    def test_public_methods_are_decorated_and_typed(self):
        contract = next(n for n in TREE.body if isinstance(n, ast.ClassDef) and n.name == 'Triangulate')
        decorated = []
        for method in [n for n in contract.body if isinstance(n, ast.FunctionDef)]:
            decorators = [ast.unparse(d) for d in method.decorator_list]
            if method.name.startswith('_'):
                self.assertEqual(decorators, [], method.name)
                continue
            self.assertEqual(len(decorators), 1, method.name)
            self.assertIn(decorators[0], ('gl.public.view', 'gl.public.write'))
            self.assertIsNotNone(method.returns, method.name)
            self.assertTrue(ast.get_docstring(method) is not None or method.name in ('contract_info', 'stats'), method.name)
            for arg in method.args.args[1:]:
                self.assertIn(ast.unparse(arg.annotation), ('str', 'int'), '%s.%s' % (method.name, arg.arg))
            decorated.append((method.name, decorators[0]))
        writes = {name for name, kind in decorated if kind == 'gl.public.write'}
        self.assertEqual(writes, {'open_claim', 'add_source', 'drop_source', 'close_claim', 'examine'})

    def test_views_never_assign_storage(self):
        contract = next(n for n in TREE.body if isinstance(n, ast.ClassDef))
        for method in [n for n in contract.body if isinstance(n, ast.FunctionDef)]:
            if [ast.unparse(d) for d in method.decorator_list] != ['gl.public.view']:
                continue
            for node in ast.walk(method):
                if isinstance(node, (ast.Assign, ast.AugAssign)):
                    targets = node.targets if isinstance(node, ast.Assign) else [node.target]
                    for target in targets:
                        self.assertFalse(
                            isinstance(target, ast.Attribute) and isinstance(target.value, ast.Name) and target.value.id == 'self',
                            'view %s assigns storage' % method.name,
                        )

    def test_only_one_contract_class_exists(self):
        classes = [n for n in TREE.body if isinstance(n, ast.ClassDef)]
        self.assertEqual([c.name for c in classes], ['Triangulate'])

    def test_storage_fields_are_declared_in_the_class_body(self):
        contract = next(n for n in TREE.body if isinstance(n, ast.ClassDef))
        declared = {n.target.id for n in contract.body if isinstance(n, ast.AnnAssign)}
        assigned = set()
        for node in ast.walk(contract):
            if isinstance(node, ast.Assign):
                for target in node.targets:
                    if isinstance(target, ast.Attribute) and isinstance(target.value, ast.Name) and target.value.id == 'self':
                        assigned.add(target.attr)
        self.assertLessEqual(assigned, declared, 'assigning an undeclared attribute would not persist')

    def test_the_constructor_initialises_every_scalar_field(self):
        contract = next(n for n in TREE.body if isinstance(n, ast.ClassDef))
        scalars = {n.target.id for n in contract.body if isinstance(n, ast.AnnAssign) and ast.unparse(n.annotation) in ('u256', 'str')}
        init = next(n for n in contract.body if isinstance(n, ast.FunctionDef) and n.name == '__init__')
        assigned = set()
        for node in ast.walk(init):
            if isinstance(node, ast.Assign):
                for target in node.targets:
                    if isinstance(target, ast.Attribute):
                        assigned.add(target.attr)
        self.assertEqual(scalars - assigned, set())

    def test_every_error_message_is_english_ascii(self):
        for node in ast.walk(TREE):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == '_fail':
                for child in ast.walk(node):
                    if isinstance(child, ast.Constant) and isinstance(child.value, str):
                        child.value.encode('ascii')

    def test_no_stray_debug_markers(self):
        for marker in ('TODO', 'FIXME', 'XXX', 'breakpoint('):
            self.assertNotIn(marker, SOURCE)


class DeterminismTests(unittest.TestCase):
    """Validators run in separate processes: the contract must not depend on hash randomisation."""

    SCRIPT = r'''
import json, sys
sys.path.insert(0, %r)
from support import *
w = World()
claim_id = w.open()
for url, sender in ((URL_ROADS, ALICE), (URL_ENGINEER, ALICE), (URL_NEWS, BOB), (URL_SOCIETY, BOB), (URL_BLOG, CAROL)):
    w.add(claim_id, url, sender=sender)
w.examine(claim_id)
print(json.dumps(w.exam('EXM-0001'), sort_keys=True))
'''

    def test_the_whole_examination_is_independent_of_the_hash_seed(self):
        outputs = set()
        for seed in ('0', '1', '12345', 'random'):
            env = dict(os.environ, PYTHONHASHSEED=seed)
            result = subprocess.run([sys.executable, '-c', self.SCRIPT % str(ROOT / 'tests')], capture_output=True, text=True, env=env, cwd=str(ROOT / 'tests'))
            self.assertEqual(result.returncode, 0, result.stderr)
            outputs.add(hashlib.sha256(result.stdout.encode()).hexdigest())
        self.assertEqual(len(outputs), 1)


class RepositoryRuleTests(unittest.TestCase):
    def test_no_persian_or_arabic_script_anywhere_in_the_repository(self):
        offenders = []
        for path in ROOT.rglob('*'):
            if not path.is_file() or any(part in SKIP_DIRS for part in path.parts):
                continue
            if path.suffix not in TEXT_SUFFIXES:
                continue
            try:
                text = path.read_text(encoding='utf-8')
            except UnicodeDecodeError:
                continue
            if ARABIC_SCRIPT.search(text):
                offenders.append(path.relative_to(ROOT).as_posix())
        self.assertEqual(offenders, [])

    def test_the_scenario_file_is_valid_and_consistent_with_the_contract(self):
        scenarios = json.loads((ROOT / 'scenarios' / 'scenarios.json').read_text(encoding='utf-8'))
        module = load_contract_module()
        self.assertGreaterEqual(len(scenarios['scenarios']), 4)
        ids = set()
        for scenario in scenarios['scenarios']:
            self.assertNotIn(scenario['id'], ids)
            ids.add(scenario['id'])
            self.assertIn(scenario['topic'], module.TOPICS)
            self.assertIn(scenario['expect'], module._ALL_VERDICTS + ('ANY_CONCLUSIVE',))
            groups = module._parse_anchors(json.dumps(scenario['anchors']), scenario['statement'])
            self.assertGreaterEqual(len(groups), 1)
            self.assertLessEqual(len(scenario['sources']), module.MAX_SOURCES)
            self.assertGreaterEqual(len(scenario['sources']), module.MIN_SOURCES_TO_EXAMINE)
            for entry in scenario['sources']:
                clean = module._validate_public_https_url(entry['url'], 'url')
                module._origin_of(clean)

    def test_scenarios_never_put_more_than_three_sources_on_one_signer(self):
        scenarios = json.loads((ROOT / 'scenarios' / 'scenarios.json').read_text(encoding='utf-8'))
        module = load_contract_module()
        for scenario in scenarios['scenarios']:
            signers = {}
            for entry in scenario['sources']:
                signers[entry.get('signer', 0)] = signers.get(entry.get('signer', 0), 0) + 1
            self.assertLessEqual(max(signers.values()), module.MAX_SOURCES_PER_ADDER, scenario['id'])
            origins = {}
            for entry in scenario['sources']:
                origin = module._origin_of(module._validate_public_https_url(entry['url'], 'url'))
                origins[origin] = origins.get(origin, 0) + 1
            self.assertLessEqual(max(origins.values()), module.MAX_SOURCES_PER_ORIGIN, scenario['id'])


if __name__ == '__main__':
    unittest.main()
