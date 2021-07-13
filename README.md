# Change Based Fault Localization

This is a library that can be used to automatically find points of failure in TypeScript Modules that are tested with Mocha.

Integrate it into you workflow by creating a `hooks.js` file.
The file should look like this:

```javascript
const createFailureLocalizationHooks  = require( "cbfl").default;
const options = {
  mochaCommand: "TS_NODE_FILES=true node ./node_modules/mocha/bin/mocha -r ts-node/register -r require-yaml -r ./test/hooks.js -t 200000" // here you can add your own requires and set a timeout according to your needs
};
const hooks = createFailureLocalizationHooks(options);
exports.mochaHooks = {
  async beforeAll() {
    hooks.beforeAll()
  },
  async afterAll() {
    hooks.afterAll()
  },
  async afterEach() {
    hooks.afterEach(this.currentTest)
  }
};

```

Now whenever/wherever you execute mocha remember to add ` -r hooks.js` to the mocha command. The fault localization happens automatically using mocha root hooks.