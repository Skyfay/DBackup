import { describe, it, expect } from "vitest";
import {
  applyNamingPattern,
  previewPattern,
  chainSegment,
  patternUsesChain,
  NAMING_TOKEN_GROUPS,
} from "@/lib/templates/naming-template-engine";

describe("naming-template-engine", () => {
  describe("NAMING_TOKEN_GROUPS", () => {
    it("should export token groups with job, date and time groups", () => {
      const groupNames = NAMING_TOKEN_GROUPS.map((g) => g.group);
      expect(groupNames).toContain("Job Info");
      expect(groupNames).toContain("Date");
      expect(groupNames).toContain("Time");
    });
  });

  describe("applyNamingPattern", () => {
    const fixedDate = new Date("2026-05-07T14:30:45Z");

    it("replaces {job_name} and {db_name} tokens", () => {
      const result = applyNamingPattern(
        "{job_name}_{db_name}",
        "MyJob",
        "mydb",
        fixedDate,
        "UTC"
      );
      expect(result).toBe("MyJob_mydb");
    });

    it("replaces date tokens correctly in UTC", () => {
      const result = applyNamingPattern(
        "backup_yyyy-MM-dd",
        "job",
        "db",
        fixedDate,
        "UTC"
      );
      expect(result).toBe("backup_2026-05-07");
    });

    it("replaces time tokens correctly in UTC", () => {
      const result = applyNamingPattern(
        "HH-mm-ss",
        "job",
        "db",
        fixedDate,
        "UTC"
      );
      expect(result).toBe("14-30-45");
    });

    it("replaces MMMM (full month name) before MM to avoid partial matches", () => {
      const result = applyNamingPattern(
        "MMMM",
        "job",
        "db",
        fixedDate,
        "UTC"
      );
      expect(result).toBe("May");
    });

    it("replaces MMM (short month name)", () => {
      const result = applyNamingPattern("MMM", "job", "db", fixedDate, "UTC");
      expect(result).toBe("May");
    });

    it("replaces all tokens in a complex pattern", () => {
      const result = applyNamingPattern(
        "{job_name}_{db_name}_yyyy-MM-dd_HH-mm-ss",
        "ProdJob",
        "users",
        fixedDate,
        "UTC"
      );
      expect(result).toBe("ProdJob_users_2026-05-07_14-30-45");
    });

    it("defaults to UTC when no timezone is provided", () => {
      const result = applyNamingPattern(
        "yyyy",
        "job",
        "db",
        fixedDate
      );
      expect(result).toBe("2026");
    });

    it("applies timezone offset when timezone is provided", () => {
      // UTC+9 (Asia/Tokyo) - 14:30 UTC becomes 23:30 JST
      const result = applyNamingPattern(
        "HH",
        "job",
        "db",
        fixedDate,
        "Asia/Tokyo"
      );
      expect(result).toBe("23");
    });

    it("handles multiple occurrences of the same token", () => {
      const result = applyNamingPattern(
        "{job_name}-{job_name}",
        "job",
        "db",
        fixedDate,
        "UTC"
      );
      expect(result).toBe("job-job");
    });

    it("returns an empty string for an empty pattern", () => {
      const result = applyNamingPattern("", "job", "db", fixedDate, "UTC");
      expect(result).toBe("");
    });

    it("passes plain text through unchanged when no tokens are present", () => {
      const result = applyNamingPattern("static-backup", "job", "db", fixedDate, "UTC");
      expect(result).toBe("static-backup");
    });

    it("does not expand date tokens that appear inside a job name", () => {
      // Job names are substituted after date tokens are resolved, so
      // date-like substrings in the name (e.g. 'yyyy') are preserved as-is.
      const result = applyNamingPattern(
        "{job_name}",
        "backup_yyyy",
        "db",
        fixedDate,
        "UTC"
      );
      expect(result).toBe("backup_yyyy");
    });

    it("does not replace 'mm' inside a job name with minutes (regression: Immich)", () => {
      // Regression test for https://github.com/Skyfay/DBackup/issues/90
      // 'Immich' contains 'mm' which must not be treated as the minutes token.
      const result = applyNamingPattern(
        "{job_name}_{db_name}_yyyy-MM-dd_HH-mm-ss",
        "Immich",
        "db",
        fixedDate,
        "UTC"
      );
      expect(result).toBe("Immich_db_2026-05-07_14-30-45");
    });

    it("shifts date correctly across day boundary in negative UTC offset", () => {
      // 2026-05-07T01:30:00Z = 2026-05-06 21:30 in America/New_York (UTC-4 EDT)
      const earlyUTC = new Date("2026-05-07T01:30:00Z");
      const result = applyNamingPattern(
        "yyyy-MM-dd",
        "job",
        "db",
        earlyUTC,
        "America/New_York"
      );
      expect(result).toBe("2026-05-06");
    });
  });

  describe("previewPattern", () => {
    it("returns a non-empty string for a valid pattern", () => {
      const result = previewPattern("{job_name}_{db_name}_yyyy-MM-dd");
      expect(result).toBeTruthy();
      expect(result).toContain("JobName");
      expect(result).toContain("mydb");
    });

    it("returns 'Invalid pattern' when pattern processing throws", () => {
      // Force an error by passing a pattern that causes String.replace to fail
      // via a broken RegExp in a monkey-patched environment is hard, so we
      // pass a value that triggers the catch via mocking String.prototype.replace.
      const original = String.prototype.replace;
      String.prototype.replace = () => {
        throw new Error("forced error");
      };
      try {
        const result = previewPattern("any-pattern");
        expect(result).toBe("Invalid pattern");
      } finally {
        String.prototype.replace = original;
      }
    });
  });

  /**
   * The {chain} token lets a template decide where the incremental position goes. The
   * separator rule is what makes it usable at all: written at the end of a pattern it would
   * otherwise leave a dangling "_" on every non-incremental backup.
   */
  describe("{chain} token", () => {
    const fixedDate = new Date("2026-05-07T14:30:45Z");
    const apply = (pattern: string, chain = "") =>
      applyNamingPattern(pattern, "MyJob", "mydb", fixedDate, "UTC", chain);

    it("inserts the chain segment where the token stands", () => {
      expect(apply("{job_name}_{chain}", "inc-001")).toBe("MyJob_inc-001");
      expect(apply("{chain}_{job_name}", "full-000")).toBe("full-000_MyJob");
    });

    it("drops a trailing separator when there is no chain", () => {
      // The case that made the token awkward: the pattern ends with _{chain}.
      expect(apply("{job_name}_yyyy-MM-dd_{chain}")).toBe("MyJob_2026-05-07");
    });

    it("drops a leading separator when there is no chain", () => {
      expect(apply("{chain}-{job_name}")).toBe("MyJob");
    });

    it("keeps exactly one separator when the token sits between two", () => {
      expect(apply("{job_name}_{chain}_yyyy")).toBe("MyJob_2026");
    });

    it("leaves a dot alone - it usually belongs to the extension", () => {
      // Eating the dot would turn "name.{chain}.sql" into "namesql".
      expect(apply("{job_name}.{chain}")).toBe("MyJob.");
      expect(apply("{job_name}.{chain}", "inc-002")).toBe("MyJob.inc-002");
    });

    it("supports a bare {chain} pattern for an incremental run", () => {
      expect(apply("{chain}", "inc-003")).toBe("inc-003");
    });

    it("falls back to a usable name when the pattern collapses to nothing", () => {
      // "{chain}" alone on a full-mode job would otherwise produce just ".tar".
      expect(apply("{chain}")).toBe("MyJob_2026-05-07_14-30-45");
    });

    it("still returns an empty string for an empty pattern", () => {
      // The collapse fallback must not change the contract for an empty pattern.
      expect(apply("")).toBe("");
    });

    it("does not treat the literal token text as date tokens", () => {
      expect(apply("{chain}", "full-000")).toBe("full-000");
    });
  });

  describe("patternUsesChain", () => {
    it("detects whether the template positions the chain itself", () => {
      expect(patternUsesChain("{job_name}_{chain}")).toBe(true);
      expect(patternUsesChain("{job_name}_yyyy-MM-dd")).toBe(false);
    });
  });

  describe("chainSegment", () => {
    it("zero-pads the position so a plain ls lists a chain in order", () => {
      expect(chainSegment("full", 0)).toBe("full-000");
      expect(chainSegment("incremental", 1)).toBe("inc-001");
      expect(chainSegment("incremental", 42)).toBe("inc-042");
      expect(chainSegment("incremental", 123)).toBe("inc-123");
    });
  });

  describe("previewPattern with a chain", () => {
    it("shows both outcomes of the same pattern", () => {
      expect(previewPattern("{job_name}_{chain}", "inc-001")).toBe("JobName_inc-001");
      expect(previewPattern("{job_name}_{chain}")).toBe("JobName");
    });
  });
});
