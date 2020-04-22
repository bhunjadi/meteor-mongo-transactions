Package.describe({
  name: 'bhunjadi:mongo-transactions',
  version: '0.0.1',
  // Brief, one-line summary of the package.
  summary: '',
  // URL to the Git repository containing the source code for this package.
  git: '',
  // By default, Meteor will default to using README.md for documentation.
  // To avoid submitting documentation, set this field to null.
  documentation: 'README.md'
});

Package.onUse(function(api) {
  api.versionsFrom('1.10.1');
  api.use('typescript');
  api.use('mongo');
  api.mainModule('src/index.ts', 'server');
});

Package.onTest(function(api) {
  api.use('typescript');
  api.use('bhunjadi:mongo-transactions');
  api.use('mongo');
  api.use('underscore');
  api.use('meteortesting:mocha');
  api.mainModule('tests/server/index.ts', 'server');
  api.mainModule('tests/client/index.ts', 'client');
});
