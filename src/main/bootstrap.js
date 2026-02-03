const { File } = require('node:buffer');

if (!global.File) {
  global.File = File;
}

require('./main');
