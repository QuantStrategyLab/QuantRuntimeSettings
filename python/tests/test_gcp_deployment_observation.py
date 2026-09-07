import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import Mock

PATH = Path(__file__).resolve().parents[2] / 'actions/publish-runtime-target-lifecycle/gcp_observation.py'
SPEC = importlib.util.spec_from_file_location('gcp_observation', PATH)
observer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(observer)

class GcpObservationTest(unittest.TestCase):
    def run_observation(self, jobs, *, traffic=None, env=None):
        service = {'status': {'url':'https://example.run.app', 'traffic':traffic if traffic is not None else [{'revisionName':'example-001','percent':100}]}}
        revision = {'spec':{'containers':[{'env':env if env is not None else [{'name':'RUNTIME_TARGET_ENABLED','value':'false'},{'name':'RUNTIME_TARGET_JSON','value':json.dumps({'strategy_profile':'example','execution_mode':'live'})}]}]}}
        runner = Mock(side_effect=[Mock(returncode=0,stdout=json.dumps(x)) for x in [service,revision,jobs]])
        result=observer.observe('example-project','example-region','example-service',run=runner)
        return result,runner

    def test_paused_jobs_and_deployed_revision_are_used(self):
        result,runner=self.run_observation([{'httpTarget':{'uri':'https://example.run.app/run'},'state':'PAUSED'}])
        self.assertEqual(result,{'runtime_enabled':False,'scheduler_state':'paused','strategy_profile':'example','execution_mode':'live'})
        self.assertIn('revisions',runner.call_args_list[1].args[0])
        self.assertTrue(all('--project=example-project' in c.args[0] for c in runner.call_args_list))

    def test_unrelated_and_health_jobs_do_not_count(self):
        result,_=self.run_observation([{'httpTarget':{'uri':'https://other.run.app/run'},'state':'ENABLED'},{'httpTarget':{'uri':'https://example.run.app/health'},'state':'ENABLED'}])
        self.assertEqual(result['scheduler_state'],'missing')

    def test_mixed_schedulers_not_enabled(self):
        result,_=self.run_observation([{'httpTarget':{'uri':'https://example.run.app/run'},'state':s} for s in ['PAUSED','ENABLED']])
        self.assertEqual(result['scheduler_state'],'mixed')

    def test_failure_and_missing_binding_stay_unknown_without_retry(self):
        runner=Mock(side_effect=TimeoutError('private provider detail'))
        self.assertIsNone(observer.observe('p','r','s',run=runner)['runtime_enabled'])
        self.assertEqual(runner.call_count,1)
        runner.reset_mock()
        self.assertEqual(observer.observe('','','',run=runner)['scheduler_state'],'unknown')
        runner.assert_not_called()

    def test_multi_revision_and_missing_switch_are_unknown(self):
        result,_=self.run_observation([],traffic=[{'revisionName':'a','percent':50},{'revisionName':'b','percent':50}])
        self.assertIsNone(result['runtime_enabled'])
        result,_=self.run_observation([],env=[{'name':'UNRELATED_SECRET','value':'never-output'}])
        self.assertIsNone(result['runtime_enabled'])
        self.assertNotIn('never-output',json.dumps(result))
