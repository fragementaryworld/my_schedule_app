'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const repository = path.join(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function launchFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule launch 中文 & spaces-'));
  const project = path.join(directory, 'project 中文 & folder'); fs.mkdirSync(project);
  for (const file of ['launch-background.ps1', 'server.js', 'open-browser.js', 'store.js', '启动.vbs', '启动.bat']) fs.copyFileSync(path.join(repository, file), path.join(project, file));
  fs.cpSync(path.join(repository, 'lib'), path.join(project, 'lib'), { recursive: true });
  const file = path.join(directory, 'user data', 'data.json'), logFile = path.join(path.dirname(file), 'startup.log');
  const environment = { ...process.env, DATA_FILE: file, PORT: '0', NO_BROWSER: '1' };
  let base, servicePid;
  const launchers = [];
  const alive = () => { if (!servicePid) return false; try { process.kill(servicePid, 0); return true; } catch { return false; } };
  t.after(async () => {
    try { servicePid = Number(fs.readFileSync(path.join(path.dirname(file), 'startup.pid'), 'utf8')) || servicePid; } catch {}
    if (base) await fetch(base + '/api/shutdown', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(1000) }).catch(() => {});
    for (let i = 0; i < 30 && alive(); i++) await delay(50);
    if (alive()) process.kill(servicePid);
    for (const launcher of launchers) if (launcher.exitCode === null) launcher.kill();
    await delay(50);
    // Windows may briefly retain working-directory or scanner handles after exit.
    await fs.promises.rm(directory, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 });
  });
  const pollLog = async () => {
    for (let i = 0; i < 150; i++) {
      let log = ''; try { log = fs.readFileSync(logFile, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      try { servicePid = Number(fs.readFileSync(path.join(path.dirname(file), 'startup.pid'), 'utf8')) || servicePid; } catch {}
      const port = log.match(/http:\/\/localhost:(\d+)\//)?.[1];
      if (port) { base = `http://127.0.0.1:${port}`; return base; }
      await delay(100);
    }
    throw new Error('隔离后台服务未启动：' + (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '没有日志'));
  };
  return { project, environment, file, logFile, pollLog, alive,
    async run(command, args, env = environment, options = {}) {
      const { expectedExit = 0, ...spawnOptions } = options;
      const child = spawn(command, args, { cwd: directory, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...spawnOptions }); launchers.push(child);
      let errors = ''; child.stderr.on('data', chunk => { errors += chunk; }); child.stdout.resume();
      const [code] = await once(child, 'exit');
      child.stdout.destroy(); child.stderr.destroy(); assert.equal(code, expectedExit, errors); return child;
    }
  };
}

async function verifyService(f) {
  const base = await f.pollLog(); assert.equal(f.alive(), true);
  assert.equal((await fetch(base + '/api/meta')).status, 200);
  const task = await fetch(base + '/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: '无窗口启动后的任务', date: '2026-10-14' }) });
  assert.equal(task.status, 201, JSON.stringify(await task.json()));
  assert.equal((await fetch(base + '/api/shutdown', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 200);
  for (let i = 0; i < 60 && f.alive(); i++) await delay(50);
  assert.equal(f.alive(), false); assert.equal(JSON.parse(fs.readFileSync(f.file, 'utf8')).tasks[0].title, '无窗口启动后的任务');
  await assert.rejects(fetch(base + '/api/meta'));
}

test('真实后台入口退出后服务继续运行，保存结束后释放进程与端口', { timeout: 25000, skip: process.platform !== 'win32' }, async t => {
  const f = await launchFixture(t); const launcher = await f.run(path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', path.join(f.project, 'launch-background.ps1')]);
  assert.equal(launcher.exitCode, 0); await verifyService(f);
});

test('旧批处理转交隐藏入口后退出，后台服务仍可保存和结束', { timeout: 25000, skip: process.platform !== 'win32' }, async t => {
  const f = await launchFixture(t);
  const launcher = await f.run(process.env.ComSpec, ['/d', '/s', '/c', `""${path.join(f.project, '启动.bat')}""`], f.environment, { windowsVerbatimArguments: true });
  assert.equal(launcher.exitCode, 0); await verifyService(f);
});

test('真实 Windows VBS 入口支持中文、空格和特殊字符路径且不会等待服务结束', { timeout: 25000, skip: process.platform !== 'win32' }, async t => {
  const f = await launchFixture(t), environment = { ...f.environment, PATH: `"${path.dirname(process.execPath)}";${process.env.PATH || process.env.Path}` };
  const launcher = await f.run(path.join(process.env.SystemRoot, 'System32', 'cscript.exe'), ['//NoLogo', '//B', path.join(f.project, '启动.vbs')], environment);
  assert.equal(launcher.exitCode, 0); await verifyService(f);
});

test('找不到 Node 时启动入口返回错误，不创建业务数据或遗留后台服务', { timeout: 15000, skip: process.platform !== 'win32' }, async t => {
  const f = await launchFixture(t), environment = { ...f.environment };
  for (const key of Object.keys(environment)) if (key.toUpperCase() === 'PATH') delete environment[key]; environment.PATH = '';
  await f.run(path.join(process.env.SystemRoot, 'System32', 'cscript.exe'), ['//NoLogo', '//B', path.join(f.project, '启动.vbs')], environment, { expectedExit: 1 });
  assert.equal(fs.existsSync(f.file), false); assert.equal(fs.existsSync(path.join(path.dirname(f.file), 'startup.pid')), false);
});

test('后台服务启动失败保留错误日志并返回失败，不误报启动成功', { timeout: 15000, skip: process.platform !== 'win32' }, async t => {
  const f = await launchFixture(t); fs.writeFileSync(path.join(f.project, 'server.js'), "throw new Error('synthetic startup failure');");
  await f.run(path.join(process.env.SystemRoot, 'System32', 'cscript.exe'), ['//NoLogo', '//B', path.join(f.project, '启动.vbs')], f.environment, { expectedExit: 1 });
  assert.match(fs.readFileSync(path.join(path.dirname(f.file), 'startup-error.log'), 'utf8'), /synthetic startup failure/);
  assert.equal(fs.existsSync(f.file), false);
});
