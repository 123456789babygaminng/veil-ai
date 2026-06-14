const { createProxy } = require("../_proxy");

module.exports = createProxy("/api/attachments/extract", ["POST"]);
