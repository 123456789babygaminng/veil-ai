const { createProxy } = require("./_proxy");

module.exports = createProxy("/api/key", ["GET"]);
