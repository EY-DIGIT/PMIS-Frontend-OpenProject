export const demoVendors = [
  { vendorId: 'VND001', vendorName: 'Apex Solutions', vendorType: 'Technology Vendor', status: 'Active', contact: 'Ravi Kumar', email: 'ravi@apex.com', phone: '9876543210', projectMapping: ['Aadhaar', 'PMIS'], startDate: '2026-04-01', endDate: '2027-03-31', address: 'Kolkata, WB', services: 'Platform development and support' },
  { vendorId: 'VND002', vendorName: 'Prime Services', vendorType: 'Service Vendor', status: 'Active', contact: 'Anita Sen', email: 'anita@prime.com', phone: '9123456780', projectMapping: ['PMIS'], startDate: '2026-05-01', endDate: '2027-04-30', address: 'Bengaluru, KA', services: 'Operations and field support' },
  { vendorId: 'VND003', vendorName: 'Nova Infra', vendorType: 'Standard Vendor', status: 'Inactive', contact: 'Mohit Das', email: 'mohit@nova.com', phone: '9988776655', projectMapping: ['UIDAI Core'], startDate: '2025-01-01', endDate: '2025-12-31', address: 'Pune, MH', services: 'Infrastructure maintenance' }
];

export const demoUsers = [
  { userId: 'USR001', fullName: 'Amit Roy', employeeId: 'EMP001', email: 'amit.roy@uidai.gov.in', role: 'Admin', vendorName: 'Apex Solutions', division: 'Technology', projectMapping: ['Aadhaar', 'PMIS'], status: 'Active' },
  { userId: 'USR002', fullName: 'Neha Das', employeeId: 'EMP002', email: 'neha.das@uidai.gov.in', role: 'Manager', vendorName: 'Prime Services', division: 'Operations', projectMapping: ['PMIS'], status: 'Active' },
  { userId: 'USR003', fullName: 'Sourav Paul', employeeId: 'EMP003', email: 'sourav.paul@uidai.gov.in', role: 'Viewer', vendorName: 'Nova Infra', division: 'Audit', projectMapping: ['Master Data'], status: 'Inactive' }
];

export const DIVISION_OPTIONS = ['TMD1', 'TMD2'];
export const PROJECT_OPTIONS = ['Aadhaar', 'PMIS', 'UIDAI Core', 'Master Data'];
export const VENDOR_TYPES = ['Standard Vendor', 'Service Vendor', 'Technology Vendor'];
export const USER_ROLES = ['Admin', 'Manager', 'Viewer'];
