# Shared Destinations and Channels

Give a destination and a notification channel of the MSP to its customers, so each customer backs up to storage it never configures and hears about its runs through a channel it never sets up.

## Why

A managed service provider keeps one S3 bucket or NAS for the backups of its customers and one mail server for their alerts. The connections and their logins belong to the [tenant](/user-guide/admin/tenants) of the MSP. Its customers, each a tenant of their own, would see nothing of them and would need a destination and a channel of their own.

Sharing closes that gap. The tenant of the MSP shares a destination or a channel with some or all of its customers. A customer names it in its jobs and templates like one of its own, while the address, the login and the settings stay with the MSP. On a shared destination each customer writes to a folder of its own and sees nothing of the others.

Only a [tenant that shares with customers](/user-guide/admin/shared-databases#tenants-that-share) shares destinations and channels, the same switch that lets it give databases away. A database connection or a directory source is never shared this way, a database of a shared server goes to a customer through [Shared Databases](/user-guide/admin/shared-databases). A tenant never passes on what another tenant shares with it.

## Who May Share

| Right | Lets you |
| :--- | :--- |
| **See what is shared** (`platform-sharing:read`) | See the card **Shared with tenants** in the details of a destination or channel, and the column **Shared with** in its list |
| **Share with customers** (`platform-sharing:write`) | Share and stop sharing, and delete the backups of a customer on a shared destination |

Both are rights of the platform in the area **Sharing**, which a [platform group](/user-guide/admin/tenants#platform-groups) gives and a platform admin holds, never the group of a tenant. They count only in a tenant that shares with customers while there is another tenant, and never in All tenants, so open the tenant of the connection first.

## Share a Destination or a Channel

1. Go to **Connections**, tab **Destinations** or **Channels**
2. Click **Share with tenants** in the menu of its row, or **Change** on the card **Shared with tenants** in its details
3. Under **Who sees it**, pick **All tenants**, which also gives it to every tenant created later, or **Picked tenants** and tick them. Each tenant shows how it uses the connection already
4. Set the terms below
5. Click **Share with** and the number of tenants

| Setting | For | What it does |
| :--- | :--- | :--- |
| **Only encrypted backups** | A destination | Off by default. A job of a customer writes to it only with a key of its own Vault. A job without a key is refused on save, and a run of one saved before writes nothing to this destination |
| **The recipients each tenant picks** | An email channel | The default. The server, the login and the sender stay with you, and each customer names its own addresses |
| **The recipients set here** | An email channel | The mail goes to the recipients of the channel, about the runs of every customer's job that names it, like a support desk of the MSP |

A chat or a webhook channel always sends where it is set, its address is the recipient.

### Where the Backups Go

A customer writes under `tenants/` and its tenant id on the destination and sees only that folder. Its Backups page, downloads, restores, retention and integrity checks never reach outside it. Your own backups stay where they are, and your tenant no longer sees `tenants/` on that destination.

A job of yours called `tenants` would write into the folder of the customers, so sharing is refused while one writes to the destination, and no job of yours gets that name while the destination is shared. Rename it first.

## What You See of Your Customers

The card **Shared with tenants** in the details of the connection says who gets it and on what terms. On a destination a bar shows how the space splits between your tenant and your customers, and each customer has a line with its jobs that write there, its backups, its last backup, the space it takes and its jobs without a key. On a channel each customer shows its jobs and templates that name it. You never see a customer's backups, only how much it keeps.

The numbers come from the storage statistics, which run every hour and after each backup. A customer shows **not measured yet** until then. The storage limit and the usage spike alerts of the destination count the backups of your customers too, since they fill the same storage. The missing backup alert watches your own backups.

The list of the tab has the column **Shared with**: **Only this tenant**, **All tenants** with how many there are today, or the number of tenants with their names.

**Delete its backups here** in the menu of a customer's line deletes every backup of that customer on the destination. Its jobs go on writing new ones, and it can no longer download or restore the old ones.

## Taking It Back

**Stop sharing with** and the name of the tenant in the menu of its line stops for one tenant. **Change** with fewer tenants, or **Picked tenants** with none ticked and **Stop sharing**, takes it from several. A tenant that loses the connection loses every link to it:

| Connection | What the tenant loses |
| :--- | :--- |
| Destination | Its backups there are deleted, and the destination leaves its jobs |
| Channel | The channel leaves its notification templates, its jobs, the channels of its notifications under **Administration → Settings → Notifications** and its recipients |

A confirmation lists each tenant with what it loses first. **Stop sharing with** on a destination also asks you to type the name of the tenant. While a run of that tenant writes to the destination, the stop waits, try again once the run finished. When the storage stops answering on the way, the tenants that lost everything already are off the share and every other one keeps it as it was.

Once nobody gets a destination any more, whatever is left in `tenants/`, like the backups of a deleted customer the storage did not take at the time, is deleted, and your tenant sees the whole destination again.

- **A shared connection cannot be deleted.** Stop sharing it first.
- **Stop sharing with customers** on the tenant is refused while it shares a destination or a channel.
- **Deleting the tenant that shares** takes its connections from its customers, but leaves their backup files on the storage.

## What the Customer Sees

The lists under **Connections** show the shared destinations and channels after the customer's own, with the column **From**, **Yours** or the tenant that shares it, and **Provided** among the quick filters after **All**, **Online**, **Issues** and **Unused**. **Backups → Destinations** has the quick filters **All**, **Yours** and **Provided** while one is provided. A destination shows **Address hidden** where its location would be, an email channel the recipients the customer named, and any other channel that the tenant that shares it decides. Its details show **Provided by** and the name instead of the settings: who keeps the address, the customer's own backups there and whether encryption is required.

The customer cannot edit, test, clone or delete a provided connection, and its health checks belong to the tenant that shares it. When the storage fails, the customer reads **The destination did not answer. The tenant that shares it can see why.**, and the log of its runs names nothing of the storage, like its host or bucket. The destination picker of a job and the channel picker of a notification template list them under **Provided by** and the name, after **Yours**, marked **address hidden** and **only encrypted backups**. **Administration → Settings → Notifications** offers the shared channels too. The Encryption part of a job warns when a picked destination takes only encrypted backups and no key is picked.

On the **Backups** page a provided destination shows **provided by** and the name. The customer browses, downloads and restores its backups there like on its own destination, but cannot **Edit alerts**, the alerts of the destination are those of the tenant that shares it.

### Recipients of a Shared Email Channel

While the channel lets each tenant pick, its details offer **Recipients** and **Send a test** to whoever holds `notifications:write`:

1. Click **Recipients**
2. Enter up to 20 addresses under **To**
3. Click **Save changes**

The addresses hold for every job and template of the tenant that names the channel. The mail goes out through the server and from the sender of the tenant that shares it. **Send a test** sends a sample message to them, once a minute at most. Until the customer names an address, the list shows **No recipients yet** and nothing goes out.

### When Sharing Stops

For 14 days the **Connections** page shows a note above the lists for each destination or channel another tenant stopped sharing: how many backups were deleted and which jobs and templates lost it. A job that lost its only destination needs another one. A notification event that named the channel alone goes to the default channels again. The cross on a note hides it in this browser. The stop also goes into the audit log of the customer, and so does the delete of the tenant that shared it.

## What a Tenant May Add

The platform decides whether a tenant adds database connections, directory sources, destinations and channels of its own, see [What It May Add](/user-guide/admin/tenants#what-it-may-add). A customer that adds no destinations itself writes only to those shared with it. **Platform → Tenants** shows what other tenants share with each tenant in the column **Provided to it**.

## Audit Log

Sharing, stopping and deleting a customer's backups go into the [audit log](/user-guide/admin/audit-log) of the tenant that shares. A stop also goes into the log of each tenant that lost the connection, with its jobs, templates and deleted backups, and a delete of its backups into its log too. The recipients a customer names go into its own log.

## Troubleshooting

### Share with Tenants Is Missing

The tenant shares nothing with customers, there is no other tenant, you lack **Share with customers**, or you look at All tenants. Database connections and directory sources are never shared this way.

### A Customer's Job Cannot Be Saved

```
Backup Storage takes only encrypted backups. Pick a key under Encryption.
```

The destination asks for **Only encrypted backups**. Pick a key of the customer's Vault under **Encryption**.

### No Mail Arrives Through a Shared Channel

```
No recipients are named for this channel yet. Add them under Connections, Channels
```

The customer named no recipients. Add them under **Recipients** in the details of the channel. The failed message shows in the notification log of the customer.

### The Connection Cannot Be Deleted

```
It is shared with other tenants. Stop sharing it first.
```

Its customers name it in their jobs and templates. Stop sharing it, then delete it.

### A Customer Cannot Add a Destination

```
Acme adds no destinations of its own. Default decides that, ask them for one.
```

The platform switched off **Destinations** under **What it may add** for that tenant. Share one with it, or switch the limit on again.

## Next Steps

- [Tenants](/user-guide/admin/tenants) - customers, platform groups and what a tenant may add
- [Shared Databases](/user-guide/admin/shared-databases) - give single databases of one server to customers
- [Encryption](/user-guide/security/encryption) - the keys of the Vault a shared destination may ask for
