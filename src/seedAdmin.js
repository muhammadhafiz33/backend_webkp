require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./config/db');

(async () => {
  try {
    const identifier = process.env.ADMIN_IDENTIFIER || 'admin';
    const raw = process.env.ADMIN_PASSWORD || 'admin123';
    const [rows] = await pool.query('SELECT id FROM users WHERE identifier = ?', [identifier]);
    if (rows.length) {
      console.log('Admin sudah ada:', identifier);
      process.exit(0);
    }
    const hash = await bcrypt.hash(raw, 10);
    await pool.query('INSERT INTO users (identifier, password_hash, role) VALUES (?, ?, ?)', [identifier, hash, 'ADMIN']);
    console.log('Admin dibuat:', identifier, 'password:', raw);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
