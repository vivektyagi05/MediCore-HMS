# 🔄 MediCore HMS System Design

## System Overview

MediCore HMS is designed around three primary actors:

1. Administrator
2. Doctor
3. Patient

Each role has dedicated workflows and permissions.

The system uses Role-Based Access Control (RBAC) to ensure secure access to features and data.

---

# User Roles

## Administrator

Responsibilities:

* Manage doctors
* Manage patients
* Monitor appointments
* Access analytics
* Manage security settings
* View system-wide information

---

## Doctor

Responsibilities:

* View assigned appointments
* Update appointment status
* Manage professional profile
* Access patient information

---

## Patient

Responsibilities:

* Register account
* Book appointments
* View appointment history
* Manage profile information

---

# Authentication Workflow

```text
User Registration
        │
        ▼
 Account Created
        │
        ▼
      Login
        │
        ▼
 JWT Token Generated
        │
        ▼
 Protected Routes
        │
        ▼
 Role Validation
        │
        ▼
 Dashboard Access
```

---

# Appointment Lifecycle

```text
Patient Books Appointment
            │
            ▼
        Pending
            │
            ▼
 Doctor Reviews Request
            │
            ▼
 Approved / Rejected
            │
            ▼
 Appointment Completed
            │
            ▼
 Stored in History
```

---

# Doctor Management Workflow

```text
Admin Creates Doctor
           │
           ▼
 Doctor Profile Created
           │
           ▼
 Doctor Login
           │
           ▼
 Doctor Dashboard Access
```

---

# Patient Management Workflow

```text
Patient Registration
          │
          ▼
 Profile Creation
          │
          ▼
 Appointment Booking
          │
          ▼
 Medical Activity History
```

---

# Dashboard Workflow

```text
Database
    │
    ▼
Analytics APIs
    │
    ▼
Dashboard Statistics
    │
    ▼
Charts & Insights
```

---

# Future AI Workflow

Planned Architecture:

```text
Patient Symptoms
        │
        ▼
Symptom Analysis Engine
        │
        ▼
AI Processing Layer
        │
        ▼
Doctor Recommendation
        │
        ▼
Medical Suggestions
```

Status:

Planned for Future Release

---

# Future Payment Workflow

Planned Architecture:

```text
Appointment Booking
         │
         ▼
 Payment Gateway
         │
         ▼
 Payment Verification
         │
         ▼
 Invoice Generation
         │
         ▼
 Transaction History
```

Status:

Implementation Pending

---

# Future Realtime Workflow

Planned Architecture:

```text
Socket Connection
        │
        ▼
User Authentication
        │
        ▼
Realtime Events
        │
 ┌──────┼──────┐
 ▼      ▼      ▼

Chat Notifications Presence
```

Status:

Infrastructure Prepared

Implementation In Progress

---

# Security Flow

```text
Request
   │
   ▼
Authentication Middleware
   │
   ▼
Authorization Middleware
   │
   ▼
Validation & Sanitization
   │
   ▼
Controller
   │
   ▼
Database
```

---

# Design Principles

The system follows:

* Separation of Concerns
* Modular Development
* Scalable Architecture
* Security First Approach
* Incremental Feature Delivery
* Maintainable Code Structure

---

# Current Development Strategy

The project is developed in iterative phases.

Each module follows:

1. Architecture Design
2. Backend Development
3. Frontend Integration
4. Testing
5. Documentation
6. Refinement

This ensures consistent project growth while maintaining code quality and long-term maintainability.
