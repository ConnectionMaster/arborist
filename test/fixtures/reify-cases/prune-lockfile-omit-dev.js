// generated from test/fixtures/prune-lockfile-omit-dev
module.exports = t => ({
  "package-lock.json": JSON.stringify({
    "name": "prune-actual",
    "version": "1.0.0",
    "lockfileVersion": 2,
    "requires": true,
    "packages": {
      "": {
        "name": "prune-actual",
        "version": "1.0.0",
        "devDependencies": {
          "once": "^1.4.0"
        }
      },
      "node_modules/abbrev": {
        "version": "1.1.1",
        "extraneous": true
      },
      "node_modules/once": {
        "version": "1.4.0",
        "dev": true
      },
      "node_modules/wrappy": {
        "version": "1.0.2",
        "extraneous": true
      }
    },
    "dependencies": {
      "abbrev": {
        "version": "1.1.1",
        "extraneous": true
      },
      "once": {
        "version": "1.4.0",
        "dev": true
      },
      "wrappy": {
        "version": "1.0.2",
        "extraneous": true
      }
    }
  }),
  "package.json": JSON.stringify({
    "name": "prune-actual",
    "version": "1.0.0",
    "devDependencies": {
      "once": "^1.4.0"
    }
  })
})
