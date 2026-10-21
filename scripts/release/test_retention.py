#!/usr/bin/env python3
"""Exercise complete release scripts offline, retaining every sandbox artifact."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
MOCK = r'''import base64, json, os, pathlib, sys
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
with open(os.environ['CALLS'], 'a') as f:
    f.write(json.dumps([name, *args]) + '\n')
sha = 'a' * 40
if name == 'git':
    if args[:3] == ['rev-parse', '-q', '--verify']: sys.exit(1)
    if args[:1] == ['rev-parse']: print(sha)
    if args[:1] == ['show']: print('{"version":"2.0.0"}')
    if args[:1] == ['ls-remote']:
        if '--refs' in args: print(sha + ' refs/tags/desktop-v1.0.0')
        elif 'refs/heads/main' in args: print(sha + ' refs/heads/main')
elif name == 'gh':
    if args[:1] == ['api']:
        if '.permissions.push' in args: print('true')
        elif any('tauri.conf.json' in a for a in args):
            pub = pathlib.Path(os.environ['KEY_DIR'], 'minisign.pub').read_bytes()
            print(json.dumps({'plugins': {'updater': {'pubkey':base64.b64encode(pub).decode()}}}))
        else: print('Fixture source')
    elif args[:2] == ['secret', 'list']:
        print('\n'.join('TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PASSWORD APPLE_CERTIFICATE APPLE_CERTIFICATE_PASSWORD APPLE_SIGNING_IDENTITY APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID CLOUDFLARE_R2_ACCOUNT_ID CLOUDFLARE_R2_ACCESS_KEY_ID CLOUDFLARE_R2_SECRET_ACCESS_KEY GPG_PRIVATE_KEY GPG_KEY_FPR'.split()))
    elif args[:2] == ['run', 'list']:
        if 'ci.yml' in args: print('completed success')
        elif 'notarize-dryrun.yml' in args or 'sidecar-smoke.yml' in args:
            print('success https://example.invalid/run')
        else: print('123')
    elif args[:2] == ['run', 'watch'] and os.environ.get('FAIL') == 'ci': sys.exit(1)
    elif args[:2] == ['release', 'view']:
        if 'isDraft' in args: print('true')
        else: print('\n'.join(['test.dmg','test.app.tar.gz','test.app.tar.gz.sig','test.msi','test-x64-setup.exe.sig','test.deb','test.rpm','test.AppImage','test.AppImage.sig']))
    elif args[:2] == ['release', 'list']:
        print('desktop-v1.0.0\ndesktop-v2.0.0')
elif name == 'curl':
    if '-w' in args: print('404', end='')
    elif '-o' in args:
        dest = args[args.index('-o') + 1]
        if dest != '/dev/null':
            data = b'fixture bundle'
            if any('latest.json' in a for a in args):
                data = json.dumps({'version': '2.0.0', 'platforms': {
                  k: {'url': 'https://example.invalid/bundle', 'signature': base64.b64encode(b'fixture').decode()}
                  for k in ['darwin-aarch64','windows-x86_64','linux-x86_64']}}).encode()
            pathlib.Path(dest).write_bytes(data)
        if '-D' in args: print('x-manifest-source: r2\r\n')
elif name == 'rsign':
    if args[:1] == ['sign']: pathlib.Path(args[-1] + '.minisig').write_text('fixture')
    if os.environ.get('FAIL') == 'signature': sys.exit(1)
elif name == 'npx':
    pathlib.Path('install-evidence.txt').write_text('fixture')
    if os.environ.get('FAIL') == 'install': sys.exit(1)
    print('vskill 2.0.0')
elif name == 'rm':
    pass # Record intent; never delete anything, even the test's own files.
else: sys.exit('unexpected mock: ' + name)
'''


class RetentionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.base = Path(tempfile.mkdtemp(prefix='vskill-release-retention-tests-'))
        print('Retained test evidence:', cls.base, file=sys.stderr)

    def run_release(self, product, flags=(), failure=''):
        case = Path(tempfile.mkdtemp(prefix=product + '-', dir=self.base))
        scripts = case / 'scripts' / 'release'
        scripts.mkdir(parents=True)
        script = scripts / ('release-' + product + '.sh')
        shutil.copyfile(ROOT / 'scripts' / 'release' / script.name, script)
        (case / 'package.json').write_text('{"version":"2.0.0"}')
        bin_dir = case / 'bin'
        bin_dir.mkdir()
        for name in ['git', 'gh', 'curl', 'rsign', 'npx', 'rm']:
            path = bin_dir / name
            path.write_text('#!' + sys.executable + '\n' + MOCK)
            path.chmod(0o700)
        keys = case / 'keys'
        keys.mkdir()
        for name in ['minisign.key', 'minisign.pub', 'minisign.passphrase']:
            (keys / name).write_text('FAKE TEST DATA ONLY\n')
        tmp = case / 'tmp'
        tmp.mkdir()
        env = dict(os.environ, PATH=str(bin_dir) + os.pathsep + os.environ['PATH'],
                   KEY_DIR=str(keys), RSIGN=str(bin_dir / 'rsign'), TMPDIR=str(tmp),
                   CALLS=str(case / 'calls.jsonl'), FAIL=failure)
        run = subprocess.run(['/bin/bash', str(script), '2.0.0', *flags], cwd=case,
                             env=env, capture_output=True, text=True, timeout=25)
        (case / 'stdout.log').write_text(run.stdout)
        (case / 'stderr.log').write_text(run.stderr)
        calls = [json.loads(line) for line in (case / 'calls.jsonl').read_text().splitlines()]
        return run, calls

    def check_success(self, run):
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)

    def test_npm_retains_install_on_success(self):
        run, calls = self.run_release('npm', ['--keep-workdir'])
        self.check_success(run)
        self.assertIn('Retained fresh-install directory:', run.stdout)
        self.assertFalse(any(c[0] == 'rm' for c in calls))
        self.assertTrue(any(c[:3] == ['gh', 'run', 'watch'] for c in calls))

    def test_npm_retains_failed_install(self):
        run, calls = self.run_release('npm', ['--keep-workdir'], 'install')
        self.assertNotEqual(run.returncode, 0)
        self.assertIn('Retained fresh-install directory:', run.stdout)
        self.assertFalse(any(c[0] == 'rm' for c in calls))

    def test_npm_default_cleanup_unchanged(self):
        for failure in ['', 'install']:
            run, calls = self.run_release('npm', failure=failure)
            self.assertEqual(run.returncode == 0, not failure)
            self.assertEqual(sum(c[0] == 'rm' for c in calls), 1)

    def test_desktop_retains_and_still_verifies_and_promotes(self):
        run, calls = self.run_release('desktop', ['--keep-workdir', '--keep-drafts'])
        self.check_success(run)
        self.assertIn('Retained release directory:', run.stdout)
        self.assertFalse(any(c[0] == 'rm' or c[:3] == ['gh', 'release', 'delete'] for c in calls))
        self.assertTrue(any(c[:3] == ['gh', 'release', 'edit'] for c in calls))
        self.assertTrue(any(c[:2] == ['rsign', 'verify'] for c in calls))
        self.assertTrue(any(c[:3] == ['gh', 'run', 'watch'] for c in calls))

    def test_desktop_dry_run_retains_without_publication(self):
        run, calls = self.run_release('desktop', ['--dry-run', '--keep-workdir', '--keep-drafts'])
        self.check_success(run)
        self.assertIn('Retained release directory:', run.stdout)
        self.assertFalse(any(c[0] == 'rm' or c[:2] == ['gh', 'release'] for c in calls))
        self.assertTrue(all('--dry-run' in c for c in calls if c[:2] == ['git', 'push']))

    def test_desktop_failure_retains_without_publication(self):
        for failure in ['signature', 'ci']:
            run, calls = self.run_release('desktop', ['--keep-workdir', '--keep-drafts'], failure)
            self.assertNotEqual(run.returncode, 0)
            self.assertIn('Retained release directory:', run.stdout)
            self.assertFalse(any(c[0] == 'rm' or c[:3] in [['gh', 'release', 'edit'], ['gh', 'release', 'delete']] for c in calls))

    def test_desktop_default_cleanup_unchanged(self):
        run, calls = self.run_release('desktop')
        self.check_success(run)
        self.assertEqual(sum(c[0] == 'rm' for c in calls), 1)
        deleted = [c[3] for c in calls if c[:3] == ['gh', 'release', 'delete']]
        self.assertEqual(deleted, ['desktop-v1.0.0'])


if __name__ == '__main__':
    unittest.main()
