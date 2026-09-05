"""Read an explicitly bound GCP deployment; emit only four allowlisted fields.

This concrete workflow adapter never changes resources or invokes the service.
Provider responses and errors remain in memory, not logs or artifacts.
"""
import json
import os
import re
import subprocess
from urllib.parse import urlsplit


def observe(project, region, service, scheduler_location=None, *, run=subprocess.run):
    result = {'runtime_enabled': None, 'scheduler_state': 'unknown',
              'strategy_profile': None, 'execution_mode': None}
    if not all(isinstance(v, str) and re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9._-]*', v)
               for v in (project, region, service, scheduler_location or region)):
        return result

    def read(args):
        response = run(['gcloud', *args, f'--project={project}', '--format=json', '--quiet'],
                       capture_output=True, text=True, timeout=45, check=False,
                       env={**os.environ, "CLOUDSDK_CORE_DISABLE_FILE_LOGGING": "1", "CLOUDSDK_CORE_LOG_HTTP": "false"})
        if response.returncode:
            raise ValueError('read unavailable')
        return json.loads(response.stdout)

    try:
        description = read(['run', 'services', 'describe', service, f'--region={region}'])
        status = description.get('status', {})
        traffic = [t for t in status.get('traffic', []) if t.get('percent', 0) > 0]
        # A pending service template is not the revision currently serving traffic.
        if len(traffic) != 1 or traffic[0].get('percent') != 100:
            return result
        revision = traffic[0].get('revisionName', '')
        if not re.fullmatch(r'[a-z][a-z0-9-]*', revision):
            return result
        deployed = read(['run', 'revisions', 'describe', revision, f'--region={region}'])
        containers = deployed.get('spec', {}).get('containers', [])
        if len(containers) != 1:
            return result
        env = {e['name']: e.get('value') for e in containers[0].get('env', []) if isinstance(e, dict) and 'name' in e}
        raw_target = env.get('RUNTIME_TARGET_JSON')
        target = json.loads(raw_target) if raw_target else {}
        if not isinstance(target, dict):
            target = {}
        enabled = env.get('RUNTIME_TARGET_ENABLED')
        result['runtime_enabled'] = {'true': True, 'false': False}.get(str(enabled).lower())
        profile = target.get('strategy_profile') or env.get('STRATEGY_PROFILE')
        if isinstance(profile, str) and re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}', profile):
            result['strategy_profile'] = profile
        mode = target.get('execution_mode') or env.get('EXECUTION_MODE')
        if mode in {'live', 'paper', 'dry_run'}:
            result['execution_mode'] = mode
        base = urlsplit(status.get('url', ''))
        if base.scheme != 'https' or not base.hostname or base.username:
            return result
        jobs = read(['scheduler', 'jobs', 'list', f'--location={scheduler_location or region}'])
        if not isinstance(jobs, list):
            return result
        states = []
        for job in jobs:
            uri = urlsplit(job.get('httpTarget', {}).get('uri', ''))
            if uri.scheme == 'https' and uri.netloc == base.netloc and uri.path.rstrip('/') == '/run':
                states.append(job.get('state'))
        if not states:
            result['scheduler_state'] = 'missing'
        elif any(s not in {'ENABLED', 'PAUSED'} for s in states):
            result['scheduler_state'] = 'unknown'
        elif len(set(states)) > 1:
            result['scheduler_state'] = 'mixed'
        else:
            result['scheduler_state'] = states[0].lower()
    except (ValueError, TypeError, KeyError, AttributeError, OSError, subprocess.SubprocessError):
        # Keep independently successful fields; never invent disabled on read failure.
        pass
    return result


if __name__ == '__main__':
    print(json.dumps(observe(os.environ.get('INPUT_GCP_PROJECT', ''),
                             os.environ.get('INPUT_CLOUD_RUN_REGION', ''),
                             os.environ.get('INPUT_CLOUD_RUN_SERVICE', ''),
                             os.environ.get('INPUT_SCHEDULER_LOCATION', ''))))
