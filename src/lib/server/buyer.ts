import { hash } from "bcryptjs";
import { z } from "zod";
import { isValidBusinessRegNumber, normalizeBusinessRegNumber } from "@/lib/business-reg-number";
import { prisma } from "./prisma";

const nullableText = (max: number) =>
  z.preprocess(
    (value) => (value === "" ? null : value),
    z.string().trim().max(max).nullable().optional(),
  );

// Normalise before validating so "123-45-67890" and "1234567890" are treated
// (and stored) as the same value — see business-reg-number.ts. The refine
// runs on the already-normalized string, so its error applies to whatever
// the checksum/format check rejects post-normalisation.
const businessRegNumberField = z
  .string()
  .trim()
  .transform(normalizeBusinessRegNumber)
  .refine(isValidBusinessRegNumber, { message: "사업자등록번호 형식이 올바르지 않습니다." });

export const buyerSignupSchema = z.object({
  loginId: z.string().trim().min(3).max(40).regex(/^[A-Za-z0-9._-]+$/),
  password: z.string().min(8).max(100),
  businessName: z.string().trim().min(1).max(120),
  businessRegNumber: businessRegNumberField,
  ownerName: z.string().trim().min(1).max(80),
  mobilePhone: z.string().trim().min(7).max(30),
  email: nullableText(160),
  businessType: nullableText(80),
  businessCategory: nullableText(120),
  postalCode: nullableText(20),
  address: nullableText(300),
  officePhone: nullableText(30),
  contact1: nullableText(80),
  contact2: nullableText(80),
});

export async function createBuyerApplication(
  data: z.infer<typeof buyerSignupSchema>,
) {
  const passwordHash = await hash(data.password, 10);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        loginId: data.loginId,
        passwordHash,
        role: "BUYER",
        email: data.email ?? null,
        businessName: data.businessName,
        businessRegNumber: data.businessRegNumber,
        businessType: data.businessType ?? null,
        businessCategory: data.businessCategory ?? null,
        ownerName: data.ownerName,
        postalCode: data.postalCode ?? null,
        address: data.address ?? null,
        officePhone: data.officePhone ?? null,
        mobilePhone: data.mobilePhone,
        contact1: data.contact1 ?? null,
        contact2: data.contact2 ?? null,
      },
    });

    return tx.buyer.create({
      data: {
        userId: user.id,
        status: "PENDING",
      },
      select: { id: true, status: true },
    });
  });
}
