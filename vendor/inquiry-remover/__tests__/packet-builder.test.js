"use strict";

const { buildExperianPacket, buildCallMetadata } = require("../src/lib/packet-builder");

const FULL_CLIENT = {
  firstName: "John",
  middleName: "A",
  lastName: "Doe",
  ssn: "123-45-6789",
  dob: "01/15/1985",
  phone: "555-000-1234",
  address: {
    line1: "456 Oak Ave",
    city: "Miami",
    state: "FL",
    zip: "33101"
  }
};

const INQUIRIES = [
  { creditorName: "Capital One", date: "2025-01-10" },
  { creditorName: "Chase Bank", date: "2025-02-20" }
];

const TRANSFER = "+15550001111";

describe("buildExperianPacket", () => {
  describe("with complete data", () => {
    let packet;
    beforeEach(() => {
      packet = buildExperianPacket(FULL_CLIENT, INQUIRIES, TRANSFER);
    });

    test("returns an object with all expected keys", () => {
      const expectedKeys = [
        "client_first_name",
        "client_middle_name",
        "client_last_name",
        "client_ssn",
        "client_dob",
        "client_zip",
        "client_address",
        "client_city",
        "client_state",
        "client_phone",
        "client_street_number",
        "inquiry_list",
        "transfer_number",
        "client_employer",
        "client_stale_address",
        "client_stale_employer"
      ];
      for (const key of expectedKeys) {
        expect(packet).toHaveProperty(key);
      }
    });

    test("formats SSN with dashes", () => {
      expect(packet.client_ssn).toBe("123-45-6789");
    });

    test("formats SSN correctly when input has no dashes", () => {
      const p = buildExperianPacket({ ...FULL_CLIENT, ssn: "123456789" }, [], TRANSFER);
      expect(p.client_ssn).toBe("123-45-6789");
    });

    test("extracts street number from address line", () => {
      expect(packet.client_street_number).toBe("456");
    });

    test("maps names correctly", () => {
      expect(packet.client_first_name).toBe("John");
      expect(packet.client_middle_name).toBe("A");
      expect(packet.client_last_name).toBe("Doe");
    });

    test("maps address fields", () => {
      expect(packet.client_zip).toBe("33101");
      expect(packet.client_city).toBe("Miami");
      expect(packet.client_state).toBe("FL");
      expect(packet.client_address).toBe("456 Oak Ave");
    });

    test("includes transfer number", () => {
      expect(packet.transfer_number).toBe(TRANSFER);
    });

    test("builds inquiry list with creditor names and dates", () => {
      expect(packet.inquiry_list).toContain("Capital One");
      expect(packet.inquiry_list).toContain("Chase Bank");
      expect(packet.inquiry_list).toContain("2025-01-10");
    });
  });

  describe("missing fields handling", () => {
    test("throws when firstName is missing", () => {
      expect(() =>
        buildExperianPacket({ ...FULL_CLIENT, firstName: "" }, [], TRANSFER)
      ).toThrow("Client first and last name are required");
    });

    test("throws when lastName is missing", () => {
      expect(() =>
        buildExperianPacket({ ...FULL_CLIENT, lastName: "" }, [], TRANSFER)
      ).toThrow("Client first and last name are required");
    });

    test("throws when SSN is missing", () => {
      expect(() =>
        buildExperianPacket({ ...FULL_CLIENT, ssn: "" }, [], TRANSFER)
      ).toThrow("Valid 9-digit SSN is required");
    });

    test("throws when SSN has wrong digit count", () => {
      expect(() =>
        buildExperianPacket({ ...FULL_CLIENT, ssn: "12345" }, [], TRANSFER)
      ).toThrow("Valid 9-digit SSN is required");
    });

    test("throws when zip is missing", () => {
      const client = { ...FULL_CLIENT, address: { ...FULL_CLIENT.address, zip: "" } };
      expect(() => buildExperianPacket(client, [], TRANSFER)).toThrow(
        "Client zip code is required"
      );
    });

    test("throws when transferNumber is missing", () => {
      expect(() => buildExperianPacket(FULL_CLIENT, [], "")).toThrow(
        "Transfer number is required"
      );
    });

    test("uses fallback inquiry_list text when inquiries array is empty", () => {
      const packet = buildExperianPacket(FULL_CLIENT, [], TRANSFER);
      expect(packet.inquiry_list).toContain("No specific inquiries");
    });

    test("uses fallback inquiry_list text when inquiries is null", () => {
      const packet = buildExperianPacket(FULL_CLIENT, null, TRANSFER);
      expect(packet.inquiry_list).toContain("No specific inquiries");
    });

    test("client_middle_name defaults to empty string when not provided", () => {
      const client = { ...FULL_CLIENT };
      delete client.middleName;
      const packet = buildExperianPacket(client, [], TRANSFER);
      expect(packet.client_middle_name).toBe("");
    });

    test("client_street_number is empty string when address has no leading number", () => {
      const client = {
        ...FULL_CLIENT,
        address: { ...FULL_CLIENT.address, line1: "PO Box 100" }
      };
      const packet = buildExperianPacket(client, [], TRANSFER);
      expect(packet.client_street_number).toBe("");
    });
  });
});

describe("buildCallMetadata", () => {
  test("returns object with client_id, bureau, batch_id, initiated_at", () => {
    const meta = buildCallMetadata("client123", "EX", "batch_abc");
    expect(meta.client_id).toBe("client123");
    expect(meta.bureau).toBe("EX");
    expect(meta.batch_id).toBe("batch_abc");
    expect(meta.initiated_at).toBeDefined();
  });

  test("generates a batch_id when not provided", () => {
    const meta = buildCallMetadata("client123", "EX");
    expect(meta.batch_id).toMatch(/^batch_\d+$/);
  });

  test("initiated_at is a valid ISO date string", () => {
    const meta = buildCallMetadata("c1", "EQ", "b1");
    expect(() => new Date(meta.initiated_at)).not.toThrow();
    expect(new Date(meta.initiated_at).toISOString()).toBe(meta.initiated_at);
  });
});
