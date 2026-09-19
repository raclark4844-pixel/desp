"use client";

import { CustomerFields } from "@/components/customer-fields";
import { useMemo, useState, type FormEvent } from "react";
import {
  industryOptions,
  industryProfiles,
  prohibitedTargetingNotice,
  type IndustryKey,
} from "@/lib/industry-profiles";

type TerritoryDraft = {
  type: "ZIP" | "COUNTY" | "CITY" | "STATE";
  value: string;
  state: string;
  county: string;
};

type ApiResponse = {
  ok: boolean;
  error?: string;
  message?: string;
  customerId?: string;
  campaignId?: string;
  status?: string;
};

const emptyTerritory = (): TerritoryDraft => ({
  type: "COUNTY",
  value: "",
  state: "",
  county: "",
});

function stringValue(form: FormData, name: string) {
  return String(form.get(name) ?? "").trim();
}

function optionalNumber(form: FormData, name: string) {
  const raw = stringValue(form, name);
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function CampaignBuilder() {
  const [industry, setIndustry] = useState<IndustryKey>("roofing");
  const [territories, setTerritories] = useState<TerritoryDraft[]>([
    emptyTerritory(),
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ApiResponse | null>(null);

  const profile = useMemo(() => industryProfiles[industry], [industry]);

  function updateTerritory(index: number, patch: Partial<TerritoryDraft>) {
    setTerritories((current) =>
      current.map((territory, territoryIndex) =>
        territoryIndex === index ? { ...territory, ...patch } : territory,
      ),
    );
  }

  function removeTerritory(index: number) {
    setTerritories((current) => {
      if (current.length === 1) return current;
      return current.filter((_, territoryIndex) => territoryIndex !== index);
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setResult(null);

    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const ownerOccupiedRaw = stringValue(form, "ownerOccupied");

    const payload = {
      customer: {
        id: stringValue(form, "customerId") || undefined,
        name: stringValue(form, "companyName"),
        websiteUrl: stringValue(form, "websiteUrl"),
        timezone: stringValue(form, "timezone") || "America/New_York",
        contactName: stringValue(form, "contactName"),
        contactEmail: stringValue(form, "contactEmail"),
      },
      campaign: {
        name: stringValue(form, "campaignName"),
        industry,
        propertyUse: stringValue(form, "propertyUse"),
        desiredLeadCount: Number(stringValue(form, "desiredLeadCount")),
        serviceLevel: stringValue(form, "serviceLevel"),
        startDate: stringValue(form, "startDate"),
        endDate: stringValue(form, "endDate"),
        channels: {
          sms: form.has("sms"),
          email: form.has("email"),
          calling: form.has("calling"),
        },
      },
      territories: territories.map((territory) => ({
        ...territory,
        value: territory.value.trim(),
        state: territory.state.trim(),
        county: territory.county.trim(),
      })),
      targeting: {
        ownerOccupied:
          ownerOccupiedRaw === "YES"
            ? true
            : ownerOccupiedRaw === "NO"
              ? false
              : null,
        minYearBuilt: optionalNumber(form, "minYearBuilt"),
        maxYearBuilt: optionalNumber(form, "maxYearBuilt"),
        minEstimatedValue: optionalNumber(form, "minEstimatedValue"),
        maxEstimatedValue: optionalNumber(form, "maxEstimatedValue"),
        leadType: stringValue(form, "leadType"),
        customCriteria: stringValue(form, "customCriteria"),
      },
      companyFax: stringValue(form, "companyFax"),
    };

    try {
      const response = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const responseBody = (await response.json()) as ApiResponse;
      setResult(responseBody);

      if (response.ok) {
        formElement.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } catch {
      setResult({
        ok: false,
        error: "The campaign service could not be reached. Please try again.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="builder" onSubmit={handleSubmit}>
      <div className="progress-strip" aria-label="Campaign setup sections">
        <span>1. Customer</span>
        <span>2. Campaign</span>
        <span>3. Territory</span>
        <span>4. Targeting</span>
      </div>

      {result ? (
        <div
          className={result.ok ? "notice success" : "notice error"}
          role="status"
        >
          <strong>
            {result.ok ? "Campaign draft created" : "Campaign not created"}
          </strong>
          <p>{result.message ?? result.error}</p>
          {result.ok && (
            <p>
              <a href="/operations#campaign-records" className="primary-button">
                Next: review and collect leads →
              </a>
              <br />
              Select your customer and campaign. An administrator can activate
              lead collection after review.
            </p>
          )}
          {result.campaignId ? (
            <dl className="result-grid">
              <div>
                <dt>Campaign ID</dt>
                <dd>{result.campaignId}</dd>
              </div>
              <div>
                <dt>Customer ID</dt>
                <dd>{result.customerId}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{result.status}</dd>
              </div>
            </dl>
          ) : null}
        </div>
      ) : null}

      <section className="form-section">
        <div className="section-heading">
          <p className="step-label">CUSTOMER</p>
          <h2>Who is this campaign for?</h2>
          <p>Saved customers keep one customer ID across their campaigns.</p>
        </div>
        <CustomerFields />
      </section>

      <section className="form-section">
        <div className="section-heading">
          <p className="step-label">CAMPAIGN</p>
          <h2>What should AP Spartan build?</h2>
          <p>
            The campaign stays in draft until an authorized AP Spartan action
            activates it.
          </p>
        </div>
        <div className="field-grid two-column">
          <label>
            Campaign name
            <input
              name="campaignName"
              required
              minLength={3}
              placeholder="Lake County Fall Roofing"
            />
          </label>
          <label>
            Industry
            <select
              name="industry"
              value={industry}
              onChange={(event) =>
                setIndustry(event.target.value as IndustryKey)
              }
            >
              {industryOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Property use
            <select name="propertyUse" defaultValue="RESIDENTIAL">
              <option value="RESIDENTIAL">Residential</option>
              <option value="COMMERCIAL">Commercial</option>
              <option value="BOTH">Residential + Commercial</option>
            </select>
          </label>
          <label>
            Desired lead count
            <input
              name="desiredLeadCount"
              type="number"
              min={25}
              max={100000}
              defaultValue={500}
              required
            />
          </label>
          <label>
            Service level
            <select name="serviceLevel" defaultValue="QUALIFIED_LEADS">
              <option value="DATA_ONLY">Lead data only</option>
              <option value="QUALIFIED_LEADS">Qualified leads</option>
              <option value="APPOINTMENTS">Appointment-focused</option>
            </select>
          </label>
          <div className="date-pair">
            <label>
              Start date
              <input name="startDate" type="date" />
            </label>
            <label>
              End date
              <input name="endDate" type="date" />
            </label>
          </div>
        </div>

        <fieldset>
          <legend>Requested communication channels</legend>
          <div className="check-row">
            <label className="check-card">
              <input type="checkbox" name="sms" /> SMS
            </label>
            <label className="check-card">
              <input type="checkbox" name="email" /> Email
            </label>
            <label className="check-card">
              <input type="checkbox" name="calling" /> Calling
            </label>
          </div>
          <p className="microcopy">
            These are preferences only. Step 2 does not connect or launch any
            messaging provider.
          </p>
        </fieldset>
      </section>

      <section className="form-section">
        <div className="section-heading split-heading">
          <div>
            <p className="step-label">TERRITORY</p>
            <h2>Where should leads come from?</h2>
            <p>
              Add counties, ZIP codes, cities, or states. Multiple territories
              stay attached to the same campaign ID.
            </p>
          </div>
          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              setTerritories((current) => [...current, emptyTerritory()])
            }
          >
            + Add territory
          </button>
        </div>

        <div className="territory-list">
          {territories.map((territory, index) => (
            <div className="territory-row" key={index}>
              <label>
                Type
                <select
                  value={territory.type}
                  onChange={(event) =>
                    updateTerritory(index, {
                      type: event.target.value as TerritoryDraft["type"],
                    })
                  }
                >
                  <option value="COUNTY">County</option>
                  <option value="ZIP">ZIP code</option>
                  <option value="CITY">City</option>
                  <option value="STATE">State</option>
                </select>
              </label>
              <label>
                Territory
                <input
                  value={territory.value}
                  required
                  placeholder={
                    territory.type === "ZIP"
                      ? "44060"
                      : territory.type === "COUNTY"
                        ? "Lake County"
                        : "Mentor"
                  }
                  onChange={(event) =>
                    updateTerritory(index, { value: event.target.value })
                  }
                />
              </label>
              <label>
                State code
                <input
                  value={territory.state}
                  maxLength={2}
                  placeholder="OH"
                  onChange={(event) =>
                    updateTerritory(index, {
                      state: event.target.value.toUpperCase(),
                    })
                  }
                />
              </label>
              <button
                type="button"
                className="remove-button"
                onClick={() => removeTerritory(index)}
                disabled={territories.length === 1}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="form-section">
        <div className="section-heading">
          <p className="step-label">TARGETING</p>
          <h2>{profile.label} lead profile</h2>
          <p>{profile.description}</p>
        </div>

        <div className="profile-card">
          <strong>Recommended signals for this industry</strong>
          <ul>
            {profile.recommendedCriteria.map((criterion) => (
              <li key={criterion}>{criterion}</li>
            ))}
          </ul>
        </div>

        <div className="field-grid two-column">
          <label>
            Owner occupied
            <select name="ownerOccupied" defaultValue="ANY">
              <option value="ANY">Any / not specified</option>
              <option value="YES">Yes</option>
              <option value="NO">No</option>
            </select>
          </label>
          <label>
            Lead type / project focus
            <input
              name="leadType"
              placeholder="Roof replacement, storm inspection, repair..."
            />
          </label>
          <label>
            Minimum year built
            <input name="minYearBuilt" type="number" min={1800} max={2100} />
          </label>
          <label>
            Maximum year built
            <input name="maxYearBuilt" type="number" min={1800} max={2100} />
          </label>
          <label>
            Minimum property value
            <input name="minEstimatedValue" type="number" min={0} step={1000} />
          </label>
          <label>
            Maximum property value
            <input name="maxEstimatedValue" type="number" min={0} step={1000} />
          </label>
        </div>

        <label>
          Additional targeting requirements
          <textarea
            name="customCriteria"
            rows={5}
            maxLength={2000}
            placeholder="Add lawful property, geography, business, or service-relevance criteria..."
          />
        </label>
        <p className="compliance-note">{prohibitedTargetingNotice}</p>
      </section>

      <div className="submit-bar">
        <div>
          <strong>Draft only</strong>
          <p>
            Creating this campaign will not purchase data, send messages, or
            contact prospects.
          </p>
        </div>
        <button className="primary-button" type="submit" disabled={submitting}>
          {submitting ? "Creating campaign…" : "Create campaign draft"}
        </button>
      </div>
    </form>
  );
}
