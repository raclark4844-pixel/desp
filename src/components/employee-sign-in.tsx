"use client";
import { useState, type FormEvent } from "react";
export function EmployeeSignIn({
  changePassword = false,
}: {
  changePassword?: boolean;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    if (changePassword && data.get("password") !== data.get("confirm")) {
      setError("New passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        changePassword ? "/api/employee/password" : "/api/employee/session",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            changePassword
              ? {
                  currentPassword: data.get("currentPassword"),
                  password: data.get("password"),
                }
              : { login: data.get("login"), password: data.get("password") },
          ),
        },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      form.reset();
      window.location.assign(
        changePassword
          ? "/login?changed=1"
          : result.mustChangePassword
            ? "/account?required=1"
            : "/operations",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to sign in.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="form-section employee-form">
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {changePassword ? (
        <label>
          Current or temporary password
          <input
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
            maxLength={128}
          />
        </label>
      ) : (
        <label>
          Username or email
          <input
            name="login"
            autoComplete="username"
            required
            maxLength={320}
            autoCapitalize="none"
          />
        </label>
      )}
      <label>
        {changePassword ? "New password" : "Password"}
        <input
          name="password"
          type="password"
          autoComplete={changePassword ? "new-password" : "current-password"}
          required
          minLength={changePassword ? 12 : 1}
          maxLength={128}
        />
      </label>
      {changePassword && (
        <>
          <label>
            Confirm new password
            <input
              name="confirm"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
            />
          </label>
          <p>
            Use 12–128 characters. After saving, sign in with your new password.
          </p>
        </>
      )}
      <button className="primary-button" disabled={busy}>
        {busy ? "Please wait…" : changePassword ? "Save password" : "Sign in"}
      </button>
      {!changePassword && (
        <p>
          Employee accounts are created by your administrator. Contact your
          administrator if you need a password reset.
        </p>
      )}
    </form>
  );
}
