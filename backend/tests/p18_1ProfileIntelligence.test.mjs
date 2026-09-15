import assert from 'node:assert/strict';
import { buildDoctorProfileIntelligence } from '../services/doctorProfileIntelligenceService.js';

const base = {
  _id: '507f1f77bcf86cd799439011',
  userId: { name: 'Real Doctor' },
  specialization: 'Cardiology',
  qualification: 'MBBS, MD',
  profilePhoto: '/uploads/doctors/real.jpg',
  bio: 'A'.repeat(120),
  hospitalName: 'Real Clinic',
  city: 'Pune',
  state: 'Maharashtra',
  languages: ['English'],
  licenseNumber: 'REG-123',
  medicalCouncil: 'State Medical Council',
  availability: [{ dayOfWeek: 'monday' }],
  documents: [{ type: 'medical_registration', status: 'verified' }],
  education: [{ degree: 'MBBS', institution: 'Medical College', year: 2018 }],
  experienceEntries: [{ title: 'Consultant', organization: 'Real Clinic', startYear: 2022 }],
  subSpecialties: ['Interventional Cardiology'],
  clinics: [{ name: 'Real Clinic' }],
  insuranceAccepted: ['Network A'],
  isActive: true,
  isVerified: true,
  verificationStatus: 'approved',
};

const complete = buildDoctorProfileIntelligence(base, { trustScore: 87 });
assert.equal(complete.profileQualityScore, 100);
assert.equal(complete.publicReadiness.ready, true);
assert.equal(complete.trustScore, 87);
assert.equal(complete.identity.id, base._id);
assert.equal(complete.attention.length, 0);

const partial = buildDoctorProfileIntelligence({
  ...base,
  profilePhoto: '',
  bio: 'short',
  qualification: '',
  availability: [],
  verificationStatus: 'pending',
  isVerified: false,
  education: [],
  experienceEntries: [],
  clinics: [],
  insuranceAccepted: [],
}, { trustScore: 0 });
assert.ok(partial.profileQualityScore < 100);
assert.equal(partial.publicReadiness.ready, false);
assert.ok(partial.attention.some((item) => item.key === 'verification-pending'));
assert.ok(partial.attention.some((item) => item.key === 'profilePhoto'));

console.log('P18.1 Profile Intelligence: PASS');
