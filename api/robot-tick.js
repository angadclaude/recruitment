// Every minute (vercel.json crons): the office robot's timer. Does nothing while the robot is Off.
'use strict';
const handler = require('./robot');

module.exports = (req, res) => {
  req.url = '/api/robot?h=tick';
  return handler(req, res);
};
