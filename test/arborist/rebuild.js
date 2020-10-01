const t = require('tap')
const _trashList = Symbol.for('trashList')
const Arborist = require('../../lib/arborist/index.js')
const {resolve, dirname} = require('path')
const fs = require('fs')
const fixtures = resolve(__dirname, '../fixtures')

const fixture = (t, p) => require(`${fixtures}/reify-cases/${p}`)(t)

const PORT = 12345 + (+process.env.TAP_CHILD_ID || 0)
t.test('setup explosive server', t => {
  // nothing in this should ever hit the server
  const server = require('http').createServer(() => {
    throw new Error('rebuild should not hit the registry')
  })
  server.listen(PORT, () => {
    t.parent.teardown(() => server.close())
    t.end()
  })
})

const registry = `http://localhost:${PORT}`
const newArb = opt => new Arborist({...opt, registry})

// track the logs that are emitted.  returns a function that removes
// the listener and provides the list of what it saw.
const logTracker = () => {
  const list = []
  const onlog = (...msg) => list.push(msg)
  process.on('log', onlog)
  return () => {
    process.removeListener('log', onlog)
    return list
  }
}

t.test('rebuild bin links for all nodes if no nodes specified', async t => {
  const path = fixture(t, 'dep-installed-without-bin-link')
  const semver = resolve(path, 'node_modules/.bin/semver')
  const mkdirp = resolve(path, 'node_modules/.bin/mkdirp')
  await newArb({path}).rebuild()
  t.equal(fs.statSync(semver).isFile(), true, 'semver bin linked')
  t.equal(fs.statSync(mkdirp).isFile(), true, 'mkdirp bin linked')
})

t.test('rebuild bin links only for specified node', async t => {
  const path = fixture(t, 'dep-installed-without-bin-link')
  const semver = resolve(path, 'node_modules/.bin/semver')
  const mkdirp = resolve(path, 'node_modules/.bin/mkdirp')
  const arb = newArb({ path })
  await arb.loadActual()
  await arb.rebuild({
    nodes: arb.actualTree.inventory.query('name', 'semver'),
  })
  t.equal(fs.statSync(semver).isFile(), true, 'semver bin linked')
  t.throws(() => fs.statSync(mkdirp), 'mkdirp bin not linked')
})

t.test('rebuild no matching nodes', async t => {
  const path = fixture(t, 'dep-installed-without-bin-link')
  const semver = resolve(path, 'node_modules/.bin/semver')
  const mkdirp = resolve(path, 'node_modules/.bin/mkdirp')
  const arb = newArb({ path })
  await arb.rebuild({ nodes: [] })
  t.throws(() => fs.statSync(semver), 'semver bin not linked')
  t.throws(() => fs.statSync(mkdirp), 'mkdirp bin not linked')
})

t.test('rebuild skip bin links', async t => {
  const path = fixture(t, 'dep-installed-without-bin-link')
  const semver = resolve(path, 'node_modules/.bin/semver')
  const mkdirp = resolve(path, 'node_modules/.bin/mkdirp')
  const arb = newArb({ path, binLinks: false })
  await arb.rebuild({ nodes: [] })
  t.throws(() => fs.statSync(semver), 'semver bin not linked')
  t.throws(() => fs.statSync(mkdirp), 'mkdirp bin not linked')
})

t.test('rebuild bundled deps', async t => {
  const path = fixture(t, 'testing-rebuild-bundle-reified')
  const file = resolve(path, 'node_modules/@isaacs/testing-rebuild-bundle-a/node_modules/@isaacs/testing-rebuild-bundle-b/cwd')
  t.throws(() => fs.statSync(file), 'file not there already (gut check)')
  const arb = newArb({path})
  await arb.rebuild()
  t.equal(fs.readFileSync(file, 'utf8'), dirname(file), 'bundle build script run')
})

t.test('rebuild bundled dep if bundling parent on the list', async t => {
  const path = fixture(t, 'testing-rebuild-bundle-reified')
  const file = resolve(path, 'node_modules/@isaacs/testing-rebuild-bundle-a/node_modules/@isaacs/testing-rebuild-bundle-b/cwd')
  t.throws(() => fs.statSync(file), 'file not there already (gut check)')
  const arb = newArb({path})
  const nodes = (await arb.loadActual()).inventory.query('name', '@isaacs/testing-rebuild-bundle-a')
  await arb.rebuild({ nodes })
  t.equal(fs.readFileSync(file, 'utf8'), dirname(file), 'bundle build script run')
})

t.test('do not rebuild bundled dep if rebuildBundle=false', async t => {
  const path = fixture(t, 'testing-rebuild-bundle-reified')
  const file = resolve(path, 'node_modules/@isaacs/testing-rebuild-bundle-a/node_modules/@isaacs/testing-rebuild-bundle-b/cwd')
  t.throws(() => fs.statSync(file), 'file not there already (gut check)')
  const arb = newArb({path, rebuildBundle: false})
  const nodes = (await arb.loadActual()).inventory.query('name', '@isaacs/testing-rebuild-bundle-a')
  await arb.rebuild({ nodes })
  t.throws(() => fs.statSync(file), 'bundle build script not run')
})

t.test('do not run scripts if ignoreScripts=true', async t => {
  const path = fixture(t, 'testing-rebuild-bundle-reified')
  const file = resolve(path, 'node_modules/@isaacs/testing-rebuild-bundle-a/node_modules/@isaacs/testing-rebuild-bundle-b/cwd')
  t.throws(() => fs.statSync(file), 'file not there already (gut check)')
  const arb = newArb({path, ignoreScripts: true})
  await arb.rebuild()
  t.throws(() => fs.statSync(file), 'bundle build script not run')
})

t.test('do nothing if ignoreScripts=true and binLinks=false', async t => {
  const path = fixture(t, 'testing-rebuild-bundle-reified')
  const file = resolve(path, 'node_modules/@isaacs/testing-rebuild-bundle-a/node_modules/@isaacs/testing-rebuild-bundle-b/cwd')
  t.throws(() => fs.statSync(file), 'file not there already (gut check)')
  const arb = newArb({path, ignoreScripts: true, binLinks: false})
  await arb.rebuild()
  t.throws(() => fs.statSync(file), 'bundle build script not run')
})

t.test('do not link bins for nodes on trash list', async t => {
  const path = fixture(t, 'dep-installed-without-bin-link')
  const semver = resolve(path, 'node_modules/.bin/semver')
  const mkdirp = resolve(path, 'node_modules/.bin/mkdirp')
  const arb = newArb({ path })
  await arb.loadActual()
  arb[_trashList].add(arb.actualTree.children.get('mkdirp').path)
  // just set this so it calls the fn, the actual test of this function
  // is in the reify rollback tests.
  await arb.rebuild({ handleOptionalFailure: true })
  t.equal(fs.statSync(semver).isFile(), true, 'semver bin linked')
  t.throws(() => fs.statSync(mkdirp), 'mkdirp bin not linked')
})

t.test('do not run scripts for nodes on trash list', async t => {
  const path = fixture(t, 'testing-rebuild-bundle-reified')
  const loc = 'node_modules/@isaacs/testing-rebuild-bundle-a/node_modules/@isaacs/testing-rebuild-bundle-b'
  const file = resolve(path, `${loc}/cwd`)
  t.throws(() => fs.statSync(file), 'file not there already (gut check)')
  const arb = newArb({path})
  await arb.loadActual()
  arb[_trashList].add(arb.actualTree.inventory.get(loc).path)
  await arb.rebuild()
  t.throws(() => fs.statSync(file), 'bundle build script not run')
})

t.test('dont blow up if package.json is borked', async t => {
  const path = fixture(t, 'testing-rebuild-bundle-reified')
  const loc = 'node_modules/@isaacs/testing-rebuild-bundle-a/node_modules/@isaacs/testing-rebuild-bundle-b'
  const file = resolve(path, loc, 'cwd')
  fs.unlinkSync(resolve(path, loc, 'package.json'))
  t.throws(() => fs.statSync(file), 'file not there already (gut check)')
  const arb = newArb({path})
  await arb.rebuild()
  t.throws(() => fs.statSync(file), 'bundle build script not run')
})

t.test('verify dep flags in script environments', async t => {
  const path = fixture(t, 'testing-rebuild-script-env-flags')
  const checkLogs = logTracker()

  const expect = {
    devdep: ['npm_package_dev'],
    optdep: ['npm_package_optional'],
    'opt-and-dev': ['npm_package_dev', 'npm_package_optional'],
    devopt: ['npm_package_dev_optional'],
  }

  const arb = newArb({path})
  // just set this so it calls the fn, the actual test of this function
  // is in the reify rollback tests.
  await arb.rebuild({ handleOptionalFailure: true })
  for (const [pkg, flags] of Object.entries(expect)) {
    const file = resolve(path, 'node_modules', pkg, 'env')
    t.strictSame(flags, fs.readFileSync(file, 'utf8').split('\n'), pkg)
  }
  t.strictSame(checkLogs().sort((a, b) =>
    a[2].localeCompare(b[2]) || (typeof a[4] === 'string' ? -1 : 1)), [
    ['info','run','devdep@1.0.0','postinstall','node_modules/devdep','node ../../env.js'],
    ['info','run','devdep@1.0.0','postinstall',{code: 0, signal: null}],
    ['info','run','devopt@1.0.0','postinstall','node_modules/devopt','node ../../env.js'],
    ['info','run','devopt@1.0.0','postinstall',{code: 0, signal: null}],
    ['info','run','opt-and-dev@1.0.0','postinstall','node_modules/opt-and-dev','node ../../env.js'],
    ['info','run','opt-and-dev@1.0.0','postinstall',{code: 0, signal: null}],
    ['info','run','optdep@1.0.0','postinstall','node_modules/optdep','node ../../env.js'],
    ['info','run','optdep@1.0.0','postinstall',{code: 0, signal: null}],
  ], 'logged script executions at info level')
})

t.test('log failed exit codes as well, even if we dont crash', async t => {
  const path = t.testdir({
    'package.json': JSON.stringify({
      optionalDependencies: { optdep: '1' },
    }),
    node_modules: {
      optdep: {
        'package.json': JSON.stringify({
          name: 'optdep',
          version: '1.2.3',
          scripts: {
            preinstall: 'exit 1',
          },
        }),
      }
    }
  })
  const arb = new Arborist({path})
  const checkLogs = logTracker()
  await arb.rebuild({ handleOptionalFailure: true })
  t.strictSame(checkLogs(), [
    ['info', 'run', 'optdep@1.2.3', 'preinstall', 'node_modules/optdep', 'exit 1'],
    ['info', 'run', 'optdep@1.2.3', 'preinstall', { code: 1, signal: null }],
    ['verbose', 'reify', 'failed optional dependency', resolve(path, 'node_modules/optdep')],
    ['silly', 'reify', 'mark', 'deleted', [resolve(path, 'node_modules/optdep')]]
  ])
})

t.test('rebuild global top bin links', async t => {
  const path = t.testdir({
    lib: {
      node_modules: {
        foo: {
          'package.json': JSON.stringify({
            name: 'foo',
            bin: 'foo.js',
            version: '1.2.3',
          }),
          'foo.js': '#!/usr/local/bin node\nconsole.log("hello")\n',
        },
      },
    },
  })
  const isWindows = process.platform === 'win32'
  const file = isWindows ? `${path}/lib/foo.cmd` : `${path}/bin/foo`
  const arb = newArb({
    path: `${path}/lib`,
    global: true,
  })
  await arb.rebuild()
  const isCorrect = isWindows ? 'isFile' : 'isSymbolicLink'
  t.equal(fs.lstatSync(file)[isCorrect](), true, 'bin was linked')
})

t.test('do not build if theres a conflicting globalTop bin', async t => {
  const path = t.testdir({
    lib: {
      node_modules: {
        foo: {
          'package.json': '',
          'foo.js': '#!/usr/local/bin node\nconsole.log("hello")\n',
        },
      },
    },
    bin: {}
  })
  const isWindows = process.platform === 'win32'
  const file = isWindows ? `${path}/lib/foo.cmd` : `${path}/bin/foo`
  fs.writeFileSync(file, 'this is not the linked bin')
  fs.writeFileSync(`${path}/lib/node_modules/foo/package.json`, JSON.stringify({
    name: 'foo',
    bin: 'foo.js',
    version: '1.2.3',
    scripts: {
      // try to get clever...
      preinstall: `node -e 'require("fs").unlinkSync(${JSON.stringify(file)})'`,
    },
  }))

  const arb = newArb({
    path: `${path}/lib`,
    global: true,
  })
  t.rejects(arb.rebuild(), { code: 'EEXIST' })
  t.equal(fs.readFileSync(file, 'utf8'), 'this is not the linked bin')
})

t.test('force overwrite the conflicting globalTop bin', async t => {
  const path = t.testdir({
    lib: {
      node_modules: {
        foo: {
          'package.json': JSON.stringify({
            name: 'foo',
            bin: 'foo.js',
            version: '1.2.3',
          }),
          'foo.js': '#!/usr/local/bin node\nconsole.log("hello")\n',
        },
      },
    },
    bin: {}
  })
  const isWindows = process.platform === 'win32'
  const file = isWindows ? `${path}/lib/foo.cmd` : `${path}/bin/foo`
  fs.writeFileSync(file, 'this is not the linked bin')

  const arb = newArb({
    path: `${path}/lib`,
    global: true,
    force: true,
  })
  await arb.rebuild()
  const isCorrect = isWindows ? 'isFile' : 'isSymbolicLink'
  t.equal(fs.lstatSync(file)[isCorrect](), true, 'bin was linked')
  t.notEqual(fs.readFileSync(file, 'utf8'), 'this is not the linked bin')
})

t.test('checkBins is fine if no bins', async t => {
  const path = t.testdir({
    lib: {
      node_modules: {
        foo: {
          'package.json': JSON.stringify({
            name: 'foo',
            version: '1.2.3',
          }),
          'foo.js': '#!/usr/local/bin node\nconsole.log("hello")\n',
        },
      },
    },
    bin: {}
  })
  const isWindows = process.platform === 'win32'
  const file = isWindows ? `${path}/lib/foo.cmd` : `${path}/bin/foo`
  fs.writeFileSync(file, 'this is not the linked bin')

  const arb = newArb({
    path: `${path}/lib`,
    global: true,
  })
  await arb.rebuild()
  t.equal(fs.readFileSync(file, 'utf8'), 'this is not the linked bin')
})

t.test('rebuild node-gyp dependencies lacking both preinstall and install scripts', async t => {
  const path = fixture(t, 'package-with-gyp-dependency-lacking-install-script')
  const arb = newArb({ path })
  await arb.loadActual()
  await arb.rebuild()
  t.ok(fs.existsSync(path + '/node_modules/node-gyp-hello-world/build/Release/greet.node'))
})
