/**
 * The tenant every installation starts with. It holds what the platform owns, like the runs of the
 * system tasks and the entries of the audit log about the platform, and it is never deleted. Its
 * roles also decide who may change the settings and the roles of the whole instance.
 */
export const HOME_TENANT_ID = "default";

/**
 * What a session of a platform admin picks to look at every tenant at once. It is no tenant: that
 * view reads every tenant and changes none of them, see the scope `all`.
 */
export const ALL_TENANTS = "*";
