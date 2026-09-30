export interface AccountProfile {
  id: string;
  loginId: string;
  role: "BUYER" | "SELLER" | "ADMIN";
  email: string | null;
  notifyOptIn: boolean;
  businessName: string;
  businessRegNumber: string;
  businessType: string | null;
  businessCategory: string | null;
  ownerName: string;
  postalCode: string | null;
  address: string | null;
  officePhone: string | null;
  mobilePhone: string;
  contact1: string | null;
  contact2: string | null;
  bankName: string | null;
  bankAccountNumber: string | null;
  bankAccountHolder: string | null;
  bankAccountVerifiedAt: string | null;
  withdrawnAt: string | null;
}
