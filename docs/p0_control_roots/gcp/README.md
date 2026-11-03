# Private KMS root records

Root records contain private project bindings and must be stored outside Git.
The provisioning command defaults to `~/.config/qsl/promotion-roots`.
Supply records to the promotion verifier using the protected Environment secret
`QSL_PROMOTION_ROOT_RECORDS_JSON`, a JSON object mapping platform to root record.
Use `QSL_PROMOTION_ROOT_PROJECTS_JSON` for the private platform/project mapping.
Keep the independently approved digest mapping in
`QSL_PROMOTION_TRUSTED_ROOTS_JSON`; never derive trust from an untrusted input.
Missing records, a wrong project, invalid structure, expiry, changed public key
or digest mismatch fail verification. No fallback to a tracked record exists.

Removing the records at the current head does not remove Git history.
No existing key, IAM permission or production secret is changed by this migration.
