import { describe, it, expect } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SystemNotificationEmail } from "@/components/email/system-notification-template";

describe("SystemNotificationEmail Template", () => {
  it("should render title in header", () => {
    const html = renderToStaticMarkup(
      <SystemNotificationEmail
        title="Backup Successful"
        message="Your backup completed."
        success={true}
      />
    );

    expect(html).toContain("Backup Successful");
  });

  it("should render message in body", () => {
    const html = renderToStaticMarkup(
      <SystemNotificationEmail
        title="Test"
        message="This is a test notification."
        success={true}
      />
    );

    expect(html).toContain("This is a test notification.");
  });

  it("should use green color for success", () => {
    const html = renderToStaticMarkup(
      <SystemNotificationEmail
        title="Success"
        message="Good job"
        success={true}
      />
    );

    // Default success color
    expect(html).toContain("#22c55e");
  });

  it("should use red color for failure", () => {
    const html = renderToStaticMarkup(
      <SystemNotificationEmail
        title="Failed"
        message="Something broke"
        success={false}
      />
    );

    expect(html).toContain("#ef4444");
  });

  it("should use custom color when provided", () => {
    const html = renderToStaticMarkup(
      <SystemNotificationEmail
        title="Login"
        message="User logged in"
        success={true}
        color="#3b82f6"
      />
    );

    expect(html).toContain("#3b82f6");
    // Should NOT use default green
    expect(html).not.toContain("#22c55e");
  });

  it("should render fields table when provided", () => {
    const html = renderToStaticMarkup(
      <SystemNotificationEmail
        title="Test"
        message="Test"
        success={true}
        fields={[
          { name: "User", value: "Alice", inline: true },
          { name: "Email", value: "alice@test.com", inline: true },
        ]}
      />
    );

    expect(html).toContain("User");
    expect(html).toContain("Alice");
    expect(html).toContain("Email");
    expect(html).toContain("alice@test.com");
    // Should render as table
    expect(html).toContain("<table");
  });

  it("should not render table when no fields provided", () => {
    const html = renderToStaticMarkup(
      <SystemNotificationEmail
        title="Test"
        message="No fields"
        success={true}
      />
    );

    expect(html).not.toContain("<table");
  });

  it("should include DBackup logo", () => {
    const html = renderToStaticMarkup(
      <SystemNotificationEmail
        title="Test"
        message="Test"
        success={true}
      />
    );

    expect(html).toContain("https://dbackup.app/logo.png");
    expect(html).toContain('alt="DBackup"');
  });

  it("should show DBackup footer text", () => {
    const html = renderToStaticMarkup(
      <SystemNotificationEmail
        title="Test"
        message="Test"
        success={true}
      />
    );

    expect(html).toContain("Sent by DBackup");
    expect(html).not.toContain("Database Backup Manager");
  });

  it("should render empty fields array without table", () => {
    const html = renderToStaticMarkup(
      <SystemNotificationEmail
        title="Test"
        message="Empty fields"
        success={true}
        fields={[]}
      />
    );

    expect(html).not.toContain("<table");
  });
});
