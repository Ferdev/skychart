from pathlib import Path
import subprocess
import sys
from unittest.mock import patch
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from sync_psc_investigation_inputs import run_transport


def test_transport_retry_and_permanent_failure():
    command=['scp','owned-input','owned-output.incoming']
    success=subprocess.CompletedProcess(command,0)
    transient=subprocess.CalledProcessError(255,command)
    with patch('sync_psc_investigation_inputs.subprocess.run',side_effect=[transient,success]) as run, patch('sync_psc_investigation_inputs.time.sleep') as sleep:
        assert run_transport(command) is success
        assert run.call_count==2
        sleep.assert_called_once_with(5)
    with patch('sync_psc_investigation_inputs.subprocess.run',side_effect=subprocess.CalledProcessError(1,command)) as run:
        with pytest.raises(subprocess.CalledProcessError):run_transport(command)
        assert run.call_count==1
    with patch('sync_psc_investigation_inputs.subprocess.run',side_effect=transient) as run, patch('sync_psc_investigation_inputs.time.sleep'):
        with pytest.raises(subprocess.CalledProcessError):run_transport(command)
        assert run.call_count==4
