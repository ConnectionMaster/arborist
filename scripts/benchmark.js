process.env.ARBORIST_DEBUG = '0'
const {Suite} = require('benchmark')
const Arborist = require('../')
const { relative, resolve } = require('path')
const rimraf = require('rimraf')
const { execSync } = require('child_process')
const shaCmd = 'git show --no-patch --pretty=%H HEAD'
const currentSha = String(execSync(shaCmd)).trim() +
  (String(execSync('git status -s -uno')).trim() ? '-dirty' : '')
const { green, red } = require('chalk')
const lastBenchmark = resolve(__dirname, 'benchmark/saved/last-benchmark.json')
const mkdirp = require('mkdirp')
const { linkSync, writeFileSync, readdirSync } = require('fs')
const registryServer = require('../test/fixtures/registry-mocks/server.js')

const options = {
  previous: null,
  warnRange: 5,
  cache: resolve(__dirname, 'benchmark/cache'),
  // save it to a specific name, so you can do stuff like this:
  //
  // node scripts/benchmark.js --save=without-foobles
  // ... put foobles in ...
  // node scripts/benchmark.js --previous=without-foobles --save=with-foobles
  save: null,
}

const allSuites = readdirSync(resolve(__dirname, 'benchmark'))
  .filter(f => /\.js$/.test(f))
  .map(f => f.replace(/\.js$/, ''))
const suites = new Set()

const usage = () => {
  console.log(`Arborist benchmark suite

Runs the specified suites, or all suites if none are specified.

Usage:
  node ${relative(process.cwd(), __filename)} [options] [<suite> ...]

Available suites:
  ${allSuites.join('\n  ')}

Add new suites by adding a .js file in ${
  relative(process.cwd(), resolve(__dirname, 'benchmark'))}

Options:
  -h --help           print this message
  --save=<name>       save the benchmark to a given name for later comparison
  --previous=<name>   the name or commit sha of a previous run to compare against
                      (defaults to the most recent benchmark run)
  --warn-range=<num>  the range of % difference where faster/slower benchmarks
                      get highlighted in green or red. (default = 5)
  --cache=<path>      folder to use for the shared cache.  Note that some suites
                      intentionally do not use this folder to test an empty cache.
                      (default = ${resolve(__dirname, 'benchmark/cache')})
`)

  process.exit(0)
}

for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i]
  if (/^--previous=/.test(arg))
    options.previous = arg.substr('--previous='.length)
  else if (/^--warn-range=[0-9]+/.test(arg))
    options.warnRange = +arg.substr('--warn-range='.length)
  else if (/^--cache=/.test(arg))
    options.cache = resolve(arg.substr('--cache='.length))
  else if (/^--save=/.test(arg)) {
    const save = arg.substr('--save='.length)
    if (/[/\\]|^\.\.?$/.test(save))
      throw new Error('save cannot have slashes or be . or ..')
    options.save = save
  } else if (/^-h/.test(arg) || /^--help/.test(arg))
    usage()
  else if (/^--/.test(arg))
    throw new Error('Unknown option: ' + arg)
  else {
    if (!allSuites.includes(arg))
      throw new Error('Unknown benchmark suite: ' + arg)
    suites.add(arg)
  }
}

if (suites.size === 0)
  allSuites.forEach(s => suites.add(s))

const suite = new Suite({
  onStart () {
    try {
      const prevName = options.previous || 'last-benchmark'
      const prev = `./benchmark/saved/${prevName}.json`
      this.previous = require(prev)
    } catch (e) {
      this.previous = null
    }
    this.date = new Date().toISOString()
    this.sha = currentSha
    this.cache = options.cache
    const msg = `test: ${this.sha} ${this.date}`
    const prev = !this.previous ? ''
      : `  vs: ${this.previous.sha} ${this.previous.date}`
    console.log('')
    console.log('ARBORIST BENCHMARKS')
    console.log(msg)
    if (prev)
      console.log(prev)
  },

  onCycle (event) {
    const bench = event.target
    const prev = this.previous && this.previous[bench.name]
    const pctDelta = prev &&
      ((bench.stats.mean - prev.stats.mean) / prev.stats.mean) * 100
    const diff = !prev ? ''
      : `${pctDelta > 0 ? '+' : ''}${pctDelta.toFixed(2)}% `
    const colorDiff = ` (${
      pctDelta >= options.warnRange + bench.stats.rme ? red(diff)
      : pctDelta <= -(options.warnRange + bench.stats.rme) ? green(diff)
      : diff
    }±${bench.stats.rme.toFixed(2)}%)`
    console.log('')
    console.log(bench.name)
    if (bench.error)
      console.log('Error:', bench.error.message || bench.error)
    else {
      console.log(
        `  ${bench.hz.toFixed(bench.hz < 100 ? 2 : 0)} ops/s @ ~${(
          bench.stats.mean * 1000
        ).toFixed(3)}ms/op${colorDiff}`
      )
      console.log(
        `  Sampled ${
          bench.stats.sample.length
        } in ${bench.times.elapsed.toFixed(2)}s.`
      )
    }
  },

  onComplete () {
    rimraf.sync(lastBenchmark)
    mkdirp.sync(resolve(__dirname, 'benchmark/saved'))
    // always save with sha
    const saveThis = resolve(__dirname, `benchmark/saved/${this.sha}.json`)
    const data = JSON.stringify(this.reduce((acc, bench) => {
      acc[bench.name] = bench
      return acc
    }, { date: this.date, sha: this.sha })) + '\n'
    writeFileSync(saveThis, data)
    if (options.save) {
      const saveFile = `benchmark/saved/${options.save}.json`
      const saveExplicit = resolve(__dirname, saveFile)
      writeFileSync(saveExplicit, data)
    }

    linkSync(saveThis, lastBenchmark)
    teardown().then(() => Promise.all([
      registryServer.stop(),
      new Promise((res, rej) => {
        rimraf(this.cache, er => er ? rej(er) : res())
      })
    ]))
  },
})

const teardowns = []
const main = async () => {
  console.log('starting mock server')
  await new Promise((res, rej) =>
    registryServer.start(er => er ? rej(er) : res()))

  options.registry = registryServer.registry
  options.registryServer = registryServer

  console.log('preparing benchmark suites', [...suites])
  // benchmark functions can do async setup
  const promises = []
  for (const s of suites) {
    const fn = require(`./benchmark/${s}.js`)
    if (typeof fn.teardown === 'function')
      teardowns.push(fn.teardown)
    promises.push(fn(suite, options))
  }
  await Promise.all(promises)

  suite.run({ async: true })
}

const teardown = async () =>
  await Promise.all(teardowns.map(t => t()))

main()
