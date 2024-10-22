import "@pnp/nodejs"; // https://pnp.github.io/pnpjs/getting-started/#using-pnpsp-spfi-factory-interface-in-nodejs
import "@pnp/sp/webs/index.js";
import { TimelinePipe } from "@pnp/core";
import { NodeFetchWithRetry } from "@pnp/nodejs";
import { SPDefault } from "@pnp/nodejs/index.js";
import { DefaultParse, InjectHeaders, Queryable } from "@pnp/queryable";
import { SPFI, spfi } from "@pnp/sp";
import { AccessToken, AzureCliCredential, AzureDeveloperCliCredential, DefaultAzureCredential } from "@azure/identity";
import { AzureIdentity, ValidCredential } from "@pnp/azidjsclient";
import { DefaultHeaders } from "@pnp/sp";
import { CommonConfig } from "./common.js";
import { setLogLevel } from "@azure/logger";

// setLogLevel("info");

export interface SharePointSiteInfo {
  tenantPrefix: string;
  siteRelativePath: string;
};

interface SharePointSiteConnection extends SharePointSiteInfo {
  spfi: SPFI;
};

const spfiCollection: SharePointSiteConnection[] = [];

export function getSPFI(spSite?: SharePointSiteInfo): SPFI {
  if (!spSite) {
    spSite = {
      tenantPrefix: CommonConfig.TenantPrefix as string,
      siteRelativePath: CommonConfig.SiteRelativePath as string,
    }
  }

  let connectionCache: SharePointSiteConnection | undefined;
  connectionCache = spfiCollection.find(
    (item) =>
      item.siteRelativePath === spSite.siteRelativePath &&
      item.tenantPrefix === spSite.tenantPrefix
  );

  if (!connectionCache) {
    connectionCache = initSPFI(spSite);
    spfiCollection.push(connectionCache);
  }
  return connectionCache.spfi
}

/**
 * Initialize the PnP SharePoint Framework Interface (SPFI) connection
 * @param spSite SharePoint site details
 * @returns SharePoint connection
 */
function initSPFI(spSite: SharePointSiteInfo): SharePointSiteConnection {
  const credential = getAzureCredential();
  const baseUrl: string = `https://${spSite.tenantPrefix}.sharepoint.com${spSite.siteRelativePath}`;
  const scopes: string[] = getScopes(spSite.tenantPrefix);
  const spConnection: SPFI = spfi(baseUrl).using(
    CustomConnection(),
    AzureIdentity(credential, scopes, undefined)
  );
  let siteConnection = spSite as SharePointSiteConnection;
  siteConnection.spfi = spConnection;
  return siteConnection;
}

/**
 * Get the access token for the SharePoint site
 * @param tenantPrefix SharePoint tenant prefix
 * @returns Access token
 */
export async function getSpAccessToken(tenantPrefix: string): Promise<AccessToken> {
  const tokenCreds = getAzureCredential();
  const scopes: string[] = getScopes(tenantPrefix);
  let accessToken = await tokenCreds.getToken(scopes);
  return accessToken;
}

/**
 * Get the scopes for the SharePoint site, depending on the environment (local or cloud)
 */
function getScopes(tenantPrefix: string): string[] {
  const scopes: string[] = [`https://${tenantPrefix}.sharepoint.com/.default`];
  if (CommonConfig.IsLocalEnvironment) {
    // When code runs locally, DefaultAzureCredential typically via the Azure CLI (which needs delegated permissions on SharePoint app to be able to connect)
    // If scope below is not added, it will connect with only scope "user_impersonation" and SharePoint will deny it
    // An additional scope is required for SharePoint to accept the token, hence the line below
    // Note: This scope cannot be added in prod because (for managed identity) because: "ManagedIdentityCredential: Multiple scopes are not supported"
    scopes.push("Sites.Selected");
  }
  return scopes;
}

function getAzureCredential(): ValidCredential {
  return withDefaultAzureCredential();
}

/**
 * Authenticate with managed identity
 */
function withDefaultAzureCredential(): ValidCredential {
  const credential = new DefaultAzureCredential(
    { managedIdentityClientId: undefined }
    // {
    //   loggingOptions: {
    //     allowLoggingAccountIdentifiers: true,
    //     enableUnsafeSupportLogging: true
    //   },
    // }
  );
  return credential;
}

function withAzureCliCredential(): ValidCredential {
  // As you can see in this example, the AzureCliCredential does not take any parameters,
  // instead relying on the Azure CLI authenticated user to authenticate.
  const credential = new AzureCliCredential();
  return credential;
}

function withAzureDeveloperCliCredential(): ValidCredential {
  // As you can see in this example, the AzureDeveloperCliCredential does not take any parameters,
  // instead relying on the Azure Developer CLI authenticated user to authenticate.
  const credential = new AzureDeveloperCliCredential();
  return credential;
}

function CustomConnection(): TimelinePipe<Queryable> {
  // Created based on https://pnp.github.io/pnpjs/core/behaviors/#composing-behaviors
  return (instance: Queryable) => {
    instance.using(
      // // use the default headers
      DefaultHeaders(),
      // use the default init
      //DefaultInit(),
      SPDefault(),
      // use node-fetch with custom retry
      NodeFetchWithRetry({
        retries: 4
      }),
      // // use the default parsing
      DefaultParse(),
      // inject customized headers to all requests
      InjectHeaders({
        UserAgent: CommonConfig.UserAgent as string,
        "X-ClientTag": CommonConfig.UserAgent as string
      }),
      // // setup node's MSAL with configuration from the environment (or any source)
      // MSAL(msalConfig, scopes)
    );
    return instance;
  };
}