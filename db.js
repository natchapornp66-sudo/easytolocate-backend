const { Pool } = require('pg');
const { databaseOptions } = require('./config');
module.exports = new Pool(databaseOptions);
