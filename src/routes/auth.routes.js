const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../config/db");
const { authenticate } = require("../middlewares/auth");

const router = express.Router();

// 🔹 Helper: JWT Generator
const generateToken = (user) => {
  const payload = { id: user.id, identifier: user.identifier, role: user.role };
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "4h" });
};

// 🔹 Helper: Input Validator
const validateFields = (fields, res) => {
  for (const [key, value] of Object.entries(fields)) {
    if (!value) {
      res.status(400).json({ message: `${key} wajib diisi` });
      return false;
    }
  }
  return true;
};

// =============================
// REGISTER
// =============================
router.post("/register", async (req, res) => {
  try {
    const { nama_lengkap, nim, email, password } = req.body || {};
    if (!validateFields({ nama_lengkap, nim, email, password }, res)) return;

    // Cek unik (NIM / Email)
    const [ex] = await pool.query(
      "SELECT id FROM users WHERE identifier = ? OR email = ?",
      [nim, email]
    );
    if (ex.length) {
      return res.status(409).json({ message: "NIM atau Email sudah terdaftar" });
    }

    const password_hash = await bcrypt.hash(password, 10);

    await pool.query(
      "INSERT INTO users (identifier, email, password_hash, role, nama_lengkap) VALUES (?, ?, ?, ?, ?)",
      [nim, email, password_hash, "MAHASISWA", nama_lengkap]
    );

    res.status(201).json({ message: "Registrasi berhasil" });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// =============================
// LOGIN
// =============================
router.post("/login", async (req, res) => {
  try {
    const { identifier, password } = req.body || {};
    if (!validateFields({ identifier, password }, res)) return;

    const [rows] = await pool.query(
      "SELECT * FROM users WHERE identifier = ?",
      [identifier]
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ message: "Akun tidak ditemukan" });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ message: "Password salah" });

    const token = generateToken(user);

    res.json({
      token,
      user: {
        id: user.id,
        nama_lengkap: user.nama_lengkap,
        identifier: user.identifier,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// =============================
// WHO AM I
// =============================
router.get("/me", authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, nama_lengkap, identifier, email, role, created_at FROM users WHERE id = ?",
      [req.user.id]
    );
    const me = rows[0];
    if (!me) return res.status(404).json({ message: "User not found" });

    res.json(me);
  } catch (err) {
    console.error("Me error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
