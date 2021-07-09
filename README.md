# Change Based Fault Localization

This is a library that can be used to automatically find points of failure in TypeScript Modules that are tested with Mocha.

Integrate it into you workflow by creating a `hooks.js` file.
The file should look like this:

```javascript
const failureLocalization = require("changeBasedFaultLocalization");
const options = {
    mochaCommand: "node .node_modules/mocha/bin/mocha -r ... -t 200000" // replace the dots with your mocha requirements
}
exports.mochaHooks = failureLocalization(options)
```

Now whenever/wherever you execute mocha remember to add ` -r hooks.js` to the mocha command. The fault localization happens automatically using mocha root hooks.