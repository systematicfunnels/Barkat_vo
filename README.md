## 🎯 Overview

**Beverly Hills Desktop** (internally called **barkat**) is a professional-grade desktop application designed to handle complex business workflows locally.

It focuses on speed, reliability, and full control — without depending on web-based systems.

---

## 🔥 Core Capabilities

- 📊 Excel automation and processing  
- 💾 Local SQLite database management  
- 📄 PDF generation and editing  
- 🖥️ Cross-platform desktop support  
- 🔐 Secure offline data handling  
- ⚡ High-performance execution  

---

## ✨ Features

### 📊 Data Management
- Excel file creation, reading, and updates  
- XLSX support with formatting  
- Bulk import/export  
- Data validation systems  

### 💾 Database
- Local SQLite integration  
- Persistent storage  
- Fast queries and structured data handling  

### 📄 PDF Tools
- Generate PDFs from data  
- Edit and manipulate documents  
- Multi-page support  

### 🖥️ Interface
- Clean UI using Ant Design  
- Responsive layout  
- Structured navigation  
- Cross-platform consistency  

### ⚙️ Developer Experience
- Full TypeScript (strict mode)  
- Hot reload development  
- ESLint + Prettier setup  
- Secure Electron preload architecture  

---

## ⚙️ Architecture

```
Frontend (React)
↓
Electron Renderer
↓
Electron Main Process
↓
SQLite + File System
```

---

## 🧠 Core Modules

- Short Engine → handles compact workflows  
- Video/Data Engine → processes structured operations  
- Translation Engine → transforms and adapts content  
- Editing Engine → modular automation logic  

---

## 🛠️ Tech Stack

**Core**
- Electron  
- electron-vite  
- electron-builder  

**Frontend**
- React  
- TypeScript  
- Vite  
- Ant Design  

**Data**
- better-sqlite3  
- ExcelJS  
- XLSX  
- pdf-lib  

**Tooling**
- ESLint  
- Prettier  

---

## 🚀 Local Setup

```bash
git clone <repo>
cd Beverly-Hills-desktop
npm install
npm run dev
```

---

## 🔨 Build

```bash
npm run build
```

Platform-specific:

```bash
npm run build:win
npm run build:mac
npm run build:linux
```

---

## 📁 Structure

```
src/
 ├── main/        # Electron backend
 └── renderer/    # React frontend

resources/        # App assets
build/            # Output
```

---

## 💾 Database

Uses SQLite for fully local storage.

- Persistent data  
- Fast performance  
- No external dependency  

---

## 🚀 Purpose

This project was built to eliminate dependency on web dashboards  
and give full control over business data workflows locally.

---

## ✨ Vision

A fully self-contained desktop system that can:

- Automate operations  
- Handle large datasets  
- Replace multiple tools with one unified system  

---

<div align="center">

**Built for performance. Designed for control.**

</div>
```
