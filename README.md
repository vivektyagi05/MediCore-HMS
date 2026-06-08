# HMS Pro Enterprise

HMS Pro Enterprise is a full-stack Hospital Management System with React, Vite, Tailwind CSS, Express, MongoDB, JWT authentication, RBAC, payments, realtime Socket.IO updates, finance workflows, patient and doctor workspaces, admin controls, and AI-assisted healthcare automation.

## Stack

- Frontend: React, Vite, Tailwind CSS, Framer Motion, React Router, Axios, Socket.IO client
- Backend: Node.js ES Modules, Express, MongoDB, Mongoose, JWT, bcrypt, Helmet, rate limiting
- Finance: Razorpay order and webhook architecture, invoices, wallet, refunds, subscriptions, reconciliation
- Realtime: Socket.IO authentication, rooms, presence, notifications, chat foundation
- Automation and AI: reminders, symptom suggestions, doctor recommendation, scheduling and analytics insights

## Project Layout

```text
.
├── backend/
│   ├── ai/
│   ├── automation/
│   ├── config/
│   ├── controllers/
│   ├── cron/
│   ├── emails/
│   ├── invoices/
│   ├── middleware/
│   ├── models/
│   ├── payments/
│   ├── routes/
│   ├── services/
│   ├── socket/
│   ├── utils/
│   ├── validations/
│   ├── app.js
│   ├── seed.js
│   └── server.js
├── docs/
├── src/
│   ├── api/
│   ├── components/
│   ├── context/
│   ├── layout/
│   ├── pages/
│   ├── routes/
│   └── socket/
├── .env.example
├── package.json
└── vite.config.js
```

## Setup

1. Install frontend dependencies:

```bash
npm install
```

2. Install backend dependencies:

```bash
cd backend
npm install
cd ..
```

3. Create environment files:

```bash
cp .env.example .env
cp backend/.env.example backend/.env
```

4. Update `backend/.env` with MongoDB, JWT, Razorpay, SMTP, and hospital details.

5. Seed the first super admin and baseline admin configuration:

```bash
npm run seed:backend
```

6. Repair existing doctor users that do not yet have doctor profiles:

```bash
npm run migrate:doctor-profiles
```

7. Run a non-destructive database integrity audit:

```bash
npm run audit:integrity
```

8. Start the backend:

```bash
npm run dev:backend
```

9. Start the frontend in a second terminal:

```bash
npm run dev:frontend
```

Frontend runs at `http://localhost:5173` and the backend API runs at `http://localhost:5000/api`.

## Seeded Access

The seed command creates a super admin only when the configured email does not already exist.

```text
Email: superadmin@hms.local
Password: ChangeMe123!
```

Change these in `backend/.env` before using a shared or production database.

## Important Endpoints

- Health: `GET /api/health`
- Auth: `/api/auth`
- Doctors: `/api/doctors`
- Appointments: `/api/appointments`
- Patient workflows: `/api/patient`
- Doctor workflows: `/api/doctor`
- Admin services/settings/permissions/CMS/features/activity/exports: `/api/admin/*`
- Payments: `/api/payments`
- Razorpay webhook: `POST /api/payments/webhooks/razorpay`
- Finance: `/api/finance`
- Wallet: `/api/wallet`
- Refunds: `/api/refunds`
- Realtime recovery/sync: `/api/realtime`
- AI: `/api/ai`

## Validation Commands

```bash
npm run lint
npm run build
npm run test:backend
```

Backend-only:

```bash
cd backend
npm test
```

## Packaging Notes

The project is ZIP-ready as source. Do not include generated or local-only folders in deployment archives:

- `node_modules/`
- `backend/node_modules/`
- `dist/`
- `backend/storage/`
- `.env`
- `.env.local`

Use the `.env.example` files as deployment templates.






Option 2: MongoDB Atlas (Recommended)

Create account:

MongoDB Atlas

Example:

MONGO_URI=mongodb+srv://vivek:Password123@cluster0.mongodb.net/hms_pro

Production me Atlas use karo.






# 🏥 MediCore HMS

### Modern Healthcare Management Platform

MediCore HMS is a full-stack healthcare management platform being developed using modern software engineering practices.

The project provides a centralized environment for patients, doctors, and administrators to manage healthcare operations through a secure and scalable architecture.

Rather than focusing on rapid feature accumulation, the project follows an iterative development approach where architecture, maintainability, scalability, and documentation are prioritized from the beginning.

---

## 🚀 Project Vision

The long-term goal of MediCore HMS is to evolve into a comprehensive healthcare operations platform supporting:

* Patient Management
* Doctor Management
* Appointment Scheduling
* Analytics & Reporting
* AI-Assisted Healthcare Services
* Secure Digital Payments
* Realtime Communication
* Security Monitoring

---

## 📌 Current Development Status

Version: **v0.1.0-alpha**

Status: **Active Development**

Current Focus:

* Foundation Stabilization
* Security Improvements
* Feature Completion
* Architecture Expansion

For detailed progress tracking:

* PROJECT_STATUS.md
* FEATURES.md

---

## ✨ Implemented Features

### Authentication & Authorization

* User Registration
* User Login
* JWT Authentication
* Role-Based Access Control
* Protected Routes

### Doctor Management

* Doctor CRUD Operations
* Doctor Search
* Doctor Profiles

### Patient Management

* Patient CRUD Operations
* Patient Profiles
* Patient Directory

### Appointment Management

* Appointment Booking
* Appointment History
* Appointment Status Management
* Appointment Cancellation

### Dashboard & Analytics

* Dashboard Overview
* Statistics Cards
* Analytics Charts

### Security Foundation

* Authentication Middleware
* Authorization Middleware
* Request Validation
* Security Layer Architecture

---

## 🧩 Architecture Prepared

The following modules have dedicated architecture and infrastructure prepared for future implementation:

### Artificial Intelligence

* AI Controller Layer
* AI Service Layer
* Symptom Checker
* Doctor Recommendations
* Predictive Analytics

### Payments & Billing

* Payment Architecture
* Wallet Architecture
* Coupon Architecture
* Refund Workflow

### Realtime Infrastructure

* Socket Layer
* Presence Tracking
* Notification System
* Live Chat Architecture

---

## 📸 Application Screenshots

### Login Page

*Add login screenshot here*

### Dashboard

*Add dashboard screenshot here*

### Doctors Module

*Add doctors screenshot here*

### Patients Module

*Add patients screenshot here*

### Appointments Module

*Add appointments screenshot here*

---

## 🏗️ Project Architecture

```text
Frontend (React + Vite)
           │
           ▼
      Express API
           │
 ┌─────────┼─────────┐
 ▼         ▼         ▼

Controllers Services Middleware
           │
           ▼
        MongoDB
           │
           ▼

Future Integrations

• AI Services
• Payment Gateway
• Socket Layer
• Notifications
```

---

## 📂 Repository Structure

```text
backend/
frontend/

docs/
├── ARCHITECTURE.md
├── SYSTEM_DESIGN.md
├── ENGINEERING_DECISIONS.md

FEATURES.md
PROJECT_STATUS.md
README.md
```

---

## 🛠️ Technology Stack

### Frontend

* React
* Vite
* Tailwind CSS

### Backend

* Node.js
* Express.js

### Database

* MongoDB
* Mongoose

### Security

* JWT Authentication
* Role-Based Access Control

### Architecture

* REST APIs
* Modular Services
* Middleware Pattern

---

## 📖 Documentation

Additional project documentation:

* ARCHITECTURE.md
* SYSTEM_DESIGN.md
* ENGINEERING_DECISIONS.md
* FEATURES.md
* PROJECT_STATUS.md

---

## 🎯 Development Roadmap

### Version 0.2

* AI Chatbot
* Symptom Checker
* Doctor Recommendations

### Version 0.3

* Razorpay Integration
* Wallet System
* Coupon Management

### Version 0.4

* Realtime Chat
* Notifications
* Presence Tracking

### Version 1.0

* Production Hardening
* Deployment
* Security Improvements
* Full Documentation

---

## 🧠 Engineering Philosophy

This project follows a structured engineering workflow:

1. Design Architecture
2. Define System Flow
3. Build Foundation
4. Implement Features
5. Document Decisions
6. Improve Scalability

The objective is to develop software that remains maintainable as complexity grows.

---

## 👨‍💻 Author

### Vivek Tyagi

B.Tech Computer Science

Interested in:

* Full Stack Development
* Software Architecture
* Backend Engineering
* AI-Powered Applications
* Scalable Systems

---

## 📄 License

This project is currently maintained for educational, learning, and portfolio purposes.
