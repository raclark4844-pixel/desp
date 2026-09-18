"use client";
import { useEffect, useState, type FormEvent } from "react";
type Employee = {
  id: string;
  name: string;
  username: string;
  email: string;
  isAdmin: boolean;
  isActive: boolean;
  mustChangePassword: boolean;
};
export function EmployeeUsers() {
  const [employees, setEmployees] = useState<Employee[]>([]),
    [currentId, setCurrentId] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    const response = await fetch("/api/employee/users", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    setEmployees(data.employees);
    setCurrentId(data.currentId);
  }
  useEffect(() => {
    void load().catch((e) => setMessage(e.message));
  }, []);
  async function save(input: object, form?: HTMLFormElement) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/employee/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      form?.reset();
      setMessage(
        "Account saved. Temporary passwords must be changed at the next sign-in.",
      );
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Unable to save account.");
    } finally {
      setBusy(false);
    }
  }
  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void save(
      {
        action: "create",
        name: data.get("name"),
        username: data.get("username"),
        email: data.get("email"),
        password: data.get("password"),
        isAdmin: data.has("admin"),
      },
      form,
    );
  }
  return (
    <>
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      <form onSubmit={create} className="form-section employee-form">
        <h2>Create an employee</h2>
        <label>
          Full name
          <input name="name" required minLength={2} maxLength={120} />
        </label>
        <label>
          User ID
          <input
            name="username"
            required
            pattern="[a-zA-Z0-9][a-zA-Z0-9._\-]{2,49}"
            minLength={3}
            maxLength={50}
            autoComplete="off"
          />
          <small>3–50 letters, numbers, dots, underscores or hyphens.</small>
        </label>
        <label>
          Email
          <input name="email" type="email" required maxLength={320} />
        </label>
        <label>
          Temporary password
          <input
            name="password"
            type="password"
            required
            minLength={12}
            maxLength={128}
            autoComplete="new-password"
          />
        </label>
        <label>
          <input name="admin" type="checkbox" /> Administrator — can manage
          employee accounts
        </label>
        <button disabled={busy} className="primary-button">
          Create employee
        </button>
        <p>
          Give the employee their user ID and temporary password privately. This
          form does not send email.
        </p>
      </form>
      <h2>Employee accounts</h2>
      {employees.map((employee) => (
        <section key={employee.id} className="form-section">
          <h3>
            {employee.name}
            {employee.id === currentId ? " (you)" : ""}
          </h3>
          <p>
            {employee.username} · {employee.email}
          </p>
          <p>
            {employee.isAdmin ? "Administrator" : "Employee"} ·{" "}
            {employee.isActive ? "Active" : "Disabled"}
            {employee.mustChangePassword ? " · Password change required" : ""}
          </p>
          {employee.id !== currentId && (
            <div className="employee-form">
              <button
                disabled={busy}
                onClick={() =>
                  void save({
                    action: "update",
                    id: employee.id,
                    isActive: !employee.isActive,
                    isAdmin: employee.isAdmin,
                  })
                }
              >
                {employee.isActive ? "Disable account" : "Enable account"}
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void save({
                    action: "update",
                    id: employee.id,
                    isActive: employee.isActive,
                    isAdmin: !employee.isAdmin,
                  })
                }
              >
                {employee.isAdmin ? "Make employee" : "Make administrator"}
              </button>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = event.currentTarget;
                  void save(
                    {
                      action: "reset",
                      id: employee.id,
                      password: new FormData(form).get("password"),
                    },
                    form,
                  );
                }}
              >
                <label>
                  New temporary password for {employee.username}
                  <input
                    name="password"
                    type="password"
                    minLength={12}
                    maxLength={128}
                    required
                    autoComplete="new-password"
                  />
                </label>
                <button disabled={busy}>
                  Reset password and sign out this employee
                </button>
              </form>
            </div>
          )}
        </section>
      ))}
    </>
  );
}
