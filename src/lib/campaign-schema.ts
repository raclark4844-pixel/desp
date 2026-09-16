import { z } from "zod";
import { industryProfiles } from "@/lib/industry-profiles";

const industryKeys = Object.keys(industryProfiles) as [keyof typeof industryProfiles, ...(keyof typeof industryProfiles)[]];

const optionalUrl = z
  .string()
  .trim()
  .max(500)
  .optional()
  .or(z.literal(""))
  .transform((value) => value || undefined)
  .refine((value) => !value || /^https?:\/\//i.test(value), {
    message: "Website must start with http:// or https://",
  });

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .or(z.literal(""))
    .transform((value) => value || undefined);

export const territorySchema = z.object({
  type: z.enum(["ZIP", "COUNTY", "CITY", "STATE"]),
  value: z.string().trim().min(2).max(120),
  state: optionalText(2),
  county: optionalText(120),
});

export const campaignIntakeSchema = z
  .object({
    customer: z.object({
      id: z.string().uuid().optional(),
      name: z.string().trim().min(2).max(160),
      websiteUrl: optionalUrl,
      timezone: z.string().trim().min(3).max(80).default("America/New_York"),
      contactName: z.string().trim().min(2).max(120),
      contactEmail: z.string().trim().email().max(320),
    }),
    campaign: z.object({
      name: z.string().trim().min(3).max(160),
      industry: z.enum(industryKeys),
      propertyUse: z.enum(["RESIDENTIAL", "COMMERCIAL", "BOTH"]),
      desiredLeadCount: z.number().int().min(25).max(100000),
      serviceLevel: z.enum(["DATA_ONLY", "QUALIFIED_LEADS", "APPOINTMENTS"]),
      startDate: optionalText(10),
      endDate: optionalText(10),
      channels: z.object({
        sms: z.boolean().default(false),
        email: z.boolean().default(false),
        calling: z.boolean().default(false),
      }),
    }),
    territories: z.array(territorySchema).min(1).max(100),
    targeting: z.object({
      ownerOccupied: z.boolean().nullable().optional(),
      minYearBuilt: z.number().int().min(1800).max(2100).nullable().optional(),
      maxYearBuilt: z.number().int().min(1800).max(2100).nullable().optional(),
      minEstimatedValue: z.number().min(0).max(100000000).nullable().optional(),
      maxEstimatedValue: z.number().min(0).max(100000000).nullable().optional(),
      leadType: optionalText(160),
      customCriteria: optionalText(2000),
    }),
    companyFax: optionalText(100),
  })
  .superRefine((data, ctx) => {
    if (data.companyFax) {
      ctx.addIssue({
        code: "custom",
        path: ["companyFax"],
        message: "Invalid submission.",
      });
    }

    if (data.targeting.minYearBuilt && data.targeting.maxYearBuilt && data.targeting.minYearBuilt > data.targeting.maxYearBuilt) {
      ctx.addIssue({
        code: "custom",
        path: ["targeting", "maxYearBuilt"],
        message: "Maximum year built must be greater than or equal to minimum year built.",
      });
    }

    if (
      data.targeting.minEstimatedValue &&
      data.targeting.maxEstimatedValue &&
      data.targeting.minEstimatedValue > data.targeting.maxEstimatedValue
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["targeting", "maxEstimatedValue"],
        message: "Maximum property value must be greater than or equal to minimum property value.",
      });
    }

    if (data.campaign.startDate && data.campaign.endDate && data.campaign.startDate > data.campaign.endDate) {
      ctx.addIssue({
        code: "custom",
        path: ["campaign", "endDate"],
        message: "End date must be on or after the start date.",
      });
    }
  });

export type CampaignIntake = z.infer<typeof campaignIntakeSchema>;
