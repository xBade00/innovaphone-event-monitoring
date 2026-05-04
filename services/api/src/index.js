require('dotenv').config();
const express = require('express');
const cors    = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api', require('./webhook'));
app.use('/api', require('./status'));

app.listen(process.env.PORT || 3001, () =>
  console.log(`API running on port ${process.env.PORT || 3001}`)
);