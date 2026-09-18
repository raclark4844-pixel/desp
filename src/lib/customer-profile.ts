import { z } from "zod";
const text = (max: number) => z.string().trim().max(max);
export const profileFields = {
  phone: "Business phone", street: "Street address", city: "City", state: "State / region", postalCode: "ZIP / postal code", hours: "Office hours", services: "Services", serviceAreas: "Service areas", notes: "Notes and details to confirm",
} as const;
export type ProfileFields = Record<keyof typeof profileFields, string>;
export function editableProfile(value: unknown): ProfileFields {
  const object = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return Object.fromEntries(Object.keys(profileFields).map(key => [key, typeof object[key] === "string" ? object[key] : ""])) as ProfileFields;
}
export const customerUpdateSchema = z.object({
  updatedAt: z.string().datetime(), name: text(160).min(2), websiteUrl: text(500).refine(v => !v || /^https?:\/\//i.test(v) && z.string().url().safeParse(v).success, "Enter a valid HTTP or HTTPS website."),
  contactName: text(120), contactEmail: text(320).refine(v => !v || z.string().email().safeParse(v).success, "Enter a valid email."), timezone: text(80).min(3),
  profile: z.object({ phone: text(60), street: text(240), city: text(120), state: text(100), postalCode: text(30), hours: text(500), services: text(2000), serviceAreas: text(2000), notes: text(6000) }).strict(),
}).strict();
