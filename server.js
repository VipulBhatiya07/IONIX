// Simple Express + Mongoose server for IONIX demo (extended)
const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const fs = require('fs');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 4000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/ionix_demo';

// middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// serve uploads
app.use('/uploads', express.static(UPLOAD_DIR));

// serve static site (keep after /uploads so uploads resolve)
app.use('/', express.static(path.join(__dirname)));

// connect to MongoDB
mongoose.connect(MONGO_URI, { useNewUrlParser:true, useUnifiedTopology:true })
  .then(()=> console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error', err));

// Schemas & Models
const messageSchema = new mongoose.Schema({
  name: String, email: String, subject: String, message: String, createdAt: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);

const categorySchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  slug: { type: String, required: true, unique: true },
  createdAt: { type: Date, default: Date.now }
});
const Category = mongoose.model('Category', categorySchema);

const productSchema = new mongoose.Schema({
  title: String,
  slug: { type: String, index: true },
  category: { type: String, default: 'Uncategorized' },
  price: Number,
  oldPrice: Number,
  rating: Number,
  images: [String],
  tech: [String],
  stock: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});
const Product = mongoose.model('Product', productSchema);

const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true, index: true },
  passwordHash: String,
  role: { type: String, default: 'customer' },
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

// Helpers
function slugify(s){ return String(s||'').toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9\-]/g,''); }

// --- API endpoints ---

// Messages
app.post('/api/messages', async (req, res) => {
  try{
    const { name, email, subject, message } = req.body;
    if(!name || !email || !message) return res.status(400).json({ error:'Missing fields' });
    const doc = await Message.create({ name, email, subject, message });
    return res.status(201).json({ id: doc._id });
  }catch(err){ console.error(err); return res.status(500).json({ error:'Server error' }); }
});
app.get('/api/messages', async (req, res) => {
  try{ const msgs = await Message.find().sort({ createdAt:-1 }).lean(); res.json(msgs); }catch(err){ console.error(err); res.status(500).json({ error:'Server error' }); }
});
app.delete('/api/messages/:id', async (req, res) => {
  try{ await Message.findByIdAndDelete(req.params.id); res.json({ ok:true }); }catch(err){ console.error(err); res.status(500).json({ error:'Server error' }); }
});

// Categories
app.get('/api/categories', async (req,res)=>{
  try{ const cats = await Category.find().sort({ name:1 }).lean(); res.json(cats); }catch(err){ console.error(err); res.status(500).json({ error:'Server error' }); }
});
app.post('/api/categories', async (req,res)=>{
  try{
    const name = (req.body.name || '').trim();
    if(!name) return res.status(400).json({ error:'Missing name' });
    const slug = slugify(name);
    const cat = await Category.findOneAndUpdate({ slug }, { name, slug }, { upsert:true, new:true, setDefaultsOnInsert:true });
    res.status(201).json(cat);
  }catch(err){ console.error(err); res.status(500).json({ error:'Server error' }); }
});
app.delete('/api/categories/:id', async (req,res)=>{
  try{ await Category.findByIdAndDelete(req.params.id); res.json({ ok:true }); }catch(err){ console.error(err); res.status(500).json({ error:'Server error' }); }
});

// --- Upload endpoint ---
// simple image upload - expects form field "image"
const storage = multer.diskStorage({
 destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
   const ext = path.extname(file.originalname) || '.jpg';
   const name = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,8) + ext;
    cb(null, name);
  }
});
const upload = multer({ storage });
app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  // return URL path relative to site root
  const url = '/uploads/' + req.file.filename;
  res.json({ url });
});

// Products
app.get('/api/products', async (req,res)=>{
  try{
    const q = {};
    if(req.query.category) q.category = req.query.category;
    const products = await Product.find(q).sort({ createdAt:-1 }).lean();
    res.json(products);
  }catch(err){ console.error(err); res.status(500).json({ error:'Server error' }); }
});
app.get('/api/products/:id', async (req,res)=>{
  try{ const p = await Product.findOne({ $or:[{ _id:req.params.id },{ slug:req.params.id }] }).lean(); if(!p) return res.status(404).json({ error:'Not found' }); res.json(p); }catch(err){ console.error(err); res.status(500).json({ error:'Server error' }); }
});
app.post('/api/products', async (req,res)=>{
  try{
    const body = req.body;
    if(!body.title) return res.status(400).json({ error:'Missing title' });
    // ensure category exists (upsert)
    if(body.category){
      const slug = slugify(body.category);
      await Category.findOneAndUpdate({ slug }, { name: body.category, slug }, { upsert:true, setDefaultsOnInsert:true });
    }
    const slug = slugify(body.title);
    // images should be an array of URLs if provided
    const doc = await Product.create({ ...body, slug, images: Array.isArray(body.images) ? body.images : (body.image ? [body.image] : []) });
    res.status(201).json(doc);
  }catch(err){ console.error(err); res.status(500).json({ error:'Server error' }); }
});
app.put('/api/products/:id', async (req,res)=>{
  try{
    const updates = req.body;
    if(updates.title) updates.slug = slugify(updates.title);
    // ensure category exists if changing
    if(updates.category){
      const slug = slugify(updates.category);
      await Category.findOneAndUpdate({ slug }, { name: updates.category, slug }, { upsert:true, setDefaultsOnInsert:true });
    }
    if(updates.image && !updates.images) updates.images = [updates.image];
    const doc = await Product.findByIdAndUpdate(req.params.id, updates, { new:true });
    res.json(doc);
  }catch(err){ console.error(err); res.status(500).json({ error:'Server error' }); }
});

// Auth (simple demo)
app.post('/api/auth/register', async (req,res)=>{
  try{
    const { name, email, password } = req.body;
    if(!email || !password) return res.status(400).json({ error:'Missing email or password' });
    const existing = await User.findOne({ email });
    if(existing) return res.status(409).json({ error:'Email already used' });
    const passwordHash = await bcrypt.hash(password, 10);
    const u = await User.create({ name, email, passwordHash });
    // return basic user info (no password)
    res.status(201).json({ id:u._id, name:u.name, email:u.email, role:u.role });
  }catch(err){ console.error(err); res.status(500).json({ error:'Server error' }); }
});
app.post('/api/auth/login', async (req,res)=>{
  try{
    const { email, password } = req.body;
    if(!email || !password) return res.status(400).json({ error:'Missing email or password' });
    const u = await User.findOne({ email });
    if(!u) return res.status(401).json({ error:'Invalid credentials' });
    const ok = await bcrypt.compare(password, u.passwordHash);
    if(!ok) return res.status(401).json({ error:'Invalid credentials' });
    res.json({ id:u._id, name:u.name, email:u.email, role:u.role });
  }catch(err){ console.error(err); res.status(500).json({ error:'Server error' }); }
});

// fallback
app.use((req,res)=> res.status(404).send('Not found'));

app.listen(PORT, ()=> console.log(`Server running on http://localhost:${PORT}`));
