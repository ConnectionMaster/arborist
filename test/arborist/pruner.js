const { resolve } = require('path')

const t = require('tap')
const Arborist = require('../../lib/arborist/index.js')

const registryServer = require('../fixtures/registry-mocks/server.js')
const { registry } = registryServer

// two little helper functions to make the loaded trees
// easier to look at in the snapshot results.
const printEdge = (edge, inout) => ({
  name: edge.name,
  type: edge.type,
  spec: edge.spec,
  ...(inout === 'in' ? {
    from: edge.from && edge.from.location,
  } : {
    to: edge.to && edge.to.location,
  }),
  ...(edge.error ? { error: edge.error } : {}),
  __proto__: { constructor: edge.constructor },
})

const printTree = tree => ({
  name: tree.name,
  location: tree.location,
  resolved: tree.resolved,
  ...(tree.extraneous ? { extraneous: true } : {
    ...(tree.dev ? { dev: true } : {}),
    ...(tree.optional ? { optional: true } : {}),
    ...(tree.devOptional && !tree.dev && !tree.optional
      ? { devOptional: true } : {}),
    ...(tree.peer ? { peer: true } : {}),
  }),
  ...(tree.inBundle ? { bundled: true } : {}),
  ...(tree.error
    ? {
      error: {
        code: tree.error.code,
        ...(tree.error.path ? { path: relative(__dirname, tree.error.path) }
          : {}),
      }
    } : {}),
  ...(tree.isLink ? {
    target: {
      name: tree.target.name,
      parent: tree.target.parent && tree.target.parent.location
    }
  } : {}),
  ...(tree.inBundle ? { bundled: true } : {}),
  ...(tree.edgesIn && tree.edgesIn.size ? {
    edgesIn: new Set([...tree.edgesIn]
      .sort((a, b) => a.from.location.localeCompare(b.from.location))
      .map(edge => printEdge(edge, 'in'))),
  } : {}),
  ...(tree.edgesOut && tree.edgesOut.size ? {
    edgesOut: new Map([...tree.edgesOut.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, edge]) => [name, printEdge(edge, 'out')]))
  } : {}),
  ...(!tree.fsChildren || !tree.fsChildren.size ? {} : {
    fsChildren: new Set([...tree.fsChildren]
      .sort((a, b) => a.path.localeCompare(b.path))
      .map(tree => printTree(tree))),
  }),
  ...(tree.target || (!tree.children || !tree.children.size) ? {}
    : {
      children: new Map([...tree.children.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([name, tree]) => [name, printTree(tree)]))
    }),
  __proto__: { constructor: tree.constructor },
})

const cwd = process.cwd()

t.cleanSnapshot = s => s.split(cwd).join('{CWD}')

t.test('setup server', { bail: true, buffered: false }, registryServer)

const fixture = (t, p) => require('../fixtures/reify-cases/' + p)(t)

const cache = t.testdir()
const pruneTree = (path, opt) =>
  new Arborist({registry, path, cache, ...(opt || {})}).prune(opt)

t.test('prune with actual tree', async t => {
  const path = fixture(t, 'prune-actual')
  const tree = await pruneTree(path)
  const dep = tree.children.get('abbrev')
  t.notOk(dep, 'dep was pruned from tree')
  t.matchSnapshot(printTree(tree))
})

t.test('prune with lockfile', async t => {
  const path = fixture(t, 'prune-lockfile')
  const tree = await pruneTree(path)
  const dep = tree.children.get('abbrev')
  t.notOk(dep, 'dep was pruned from tree')
  t.matchSnapshot(printTree(tree))
})

t.test('prune with actual tree omit dev', async t => {
  const path = fixture(t, 'prune-actual-omit-dev')
  const tree = await pruneTree(path, { omit: ['dev'] })

  const prodDep = tree.children.get('abbrev')
  t.notOk(prodDep, 'missing prod dep was pruned from tree')

  const devDep = tree.children.get('once')
  t.notOk(devDep, 'all listed dev deps pruned from tree')

  t.matchSnapshot(
    require(path + '/package-lock.json'),
    'should keep dev dependencies in package-lock.json'
  )
  t.matchSnapshot(
    printTree(tree),
    'should remove all deps from reified tree'
  )
})

t.test('prune with lockfile omit dev', async t => {
  const path = fixture(t, 'prune-lockfile-omit-dev')
  const tree = await pruneTree(path, { omit: ['dev'] })

  const prodDep = tree.children.get('abbrev')
  t.notOk(prodDep, 'missing prod dep was pruned from tree')

  const devDep = tree.children.get('once')
  t.notOk(devDep, 'all listed dev deps pruned from tree')

  t.matchSnapshot(
    require(path + '/package-lock.json'),
    'should keep dev dependencies in package-lock.json'
  )
  t.matchSnapshot(
    printTree(tree),
    'should remove all deps from reified tree'
  )
})

t.test('prune omit dev with bins', async t => {
  const fs = require('fs')
  const { promisify } = require('util')
  const readdir = promisify(fs.readdir)
  const path = fixture(t, 'prune-dev-bins')

  // should have bin files
  const reifiedBin = resolve(path, 'node_modules/.bin/yes')
  if (process.platform === 'win32')
    t.ok(fs.statSync(reifiedBin + '.cmd').isFile(), 'should have shim')
  else
    t.ok(fs.lstatSync(reifiedBin).isSymbolicLink(), 'should have symlink')

  // PRUNE things
  const tree = await pruneTree(path, { prefix: path, omit: ['dev'] })
  const dirs = await readdir(path + '/node_modules')

  // bindirs are never removed
  // they should remain after prune
  t.same(dirs, ['.bin', '.package-lock.json'], 'should keep bin dir')

  const devDep = tree.children.get('yes')
  t.notOk(devDep, 'all listed dev deps pruned from tree')

  // should also remove ./bin/* files
  const bin = resolve(path, 'node_modules/.bin/yes')
  if (process.platform === 'win32')
    t.throws(() => fs.statSync(bin + '.cmd').isFile(), /ENOENT/, 'should not have shim')
  else
    t.throws(() => fs.lstatSync(bin).isSymbolicLink(), /ENOENT/, 'should not have symlink')
})

t.test('prune do not omit duplicated dependecy in prod and dev', async t => {
  const path = fixture(t, 'prune-dev-dep-duplicate')
  const tree = await pruneTree(path, { omit: ['dev'] })

  const dep = tree.children.get('once')
  t.ok(dep, 'dep should exist')
})
