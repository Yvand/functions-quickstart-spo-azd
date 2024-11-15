---
name: Azure Functions for SharePoint Online
description: This quickstart uses azd CLI to deploy Azure Functions which can connect to your own SharePoint Online tenant.
page_type: sample
languages:
- azdeveloper
- bicep
- nodejs
- typescript
products:
- azure-functions
- sharepoint-online
urlFragment: functions-quickstart-spo-azd
---

# Azure Functions for SharePoint Online

This quickstart uses Azure Developer command-line (azd) tools to deploy Azure Functions which can list, register and process [SharePoint Online webhooks](https://learn.microsoft.com/sharepoint/dev/apis/webhooks/overview-sharepoint-webhooks) on your own tenant.  
The resources deployed in Azure are configured with a high level of security: No public access is allowed on critical resources (storage account and key vault) except on specified IPs (configurable), and authorization is granted only through the functions service's managed identity (no access key or legacy access policy is enabled).

## Prerequisites

+ [Node.js 20](https://www.nodejs.org/)
+ [Azure Functions Core Tools](https://learn.microsoft.com/azure/azure-functions/functions-run-local?pivots=programming-language-typescript#install-the-azure-functions-core-tools)
+ [Azure Developer CLI (AZD)](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd)
+ To use Visual Studio Code to run and debug locally:
  + [Visual Studio Code](https://code.visualstudio.com/)
  + [Azure Functions extension](https://marketplace.visualstudio.com/items?itemName=ms-azuretools.vscode-azurefunctions)

## Initialize the local project

You can initialize a project from this `azd` template in one of these ways:

+ Use this `azd init` command from an empty local (root) folder:


    ```shell
    azd init --template Yvand/functions-quickstart-spo-azd
    ```

    Supply an environment name, such as `spofuncs-quickstart` when prompted. In `azd`, the environment is used to maintain a unique deployment context for your app.

+ Clone the GitHub template repository locally using the `git clone` command:

    ```shell
    git clone https://github.com/Yvand/functions-quickstart-spo-azd.git
    cd functions-quickstart-spo-azd
    ```

    You can also clone the repository from your own fork in GitHub.

## Prepare your local environment

Add a file named `local.settings.json` in the root of your project with the following contents:

```json
{
    "IsEncrypted": false,
    "Values": {
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "FUNCTIONS_WORKER_RUNTIME": "node",
    "TenantPrefix": "YOUR_SHAREPOINT_TENANT_PREFIX",
    "SiteRelativePath": "/sites/YOUR_SHAREPOINT_SITE_NAME"
    }
}
```

# Grant the functions access to SharePoint Online

The authentication to SharePoint is done using `DefaultAzureCredential`, so the credential used depends if the functions run on the local environment, or in Azure.  
If you never heard about `DefaultAzureCredential`, you should familirize yourself with its concept by reading [this article](https://aka.ms/azsdk/js/identity/credential-chains#use-defaultazurecredential-for-flexibility), before continuing.

## Grant the functions access to SharePoint when they run on the local environment

`DefaultAzureCredential` will preferentially use the delegated credentials of `Azure CLI` to authenticate to SharePoint.  
Use the Microsoft Graph PowerShell script below to grant the SharePoint delegated permission `AllSites.Manage` to the `Azure CLI`'s service principal:

```powershell
Connect-MgGraph -Scope "Application.Read.All", "DelegatedPermissionGrant.ReadWrite.All"
$scopeName = "AllSites.Manage"
$requestorAppPrincipalObj = Get-MgServicePrincipal -Filter "displayName eq 'Microsoft Azure CLI'"
$resourceAppPrincipalObj = Get-MgServicePrincipal -Filter "displayName eq 'Office 365 SharePoint Online'"

$params = @{
  clientId = $requestorAppPrincipalObj.Id
  consentType = "AllPrincipals"
  resourceId = $resourceAppPrincipalObj.Id
  scope = $scopeName
}
New-MgOauth2PermissionGrant -BodyParameter $params
```

> [!WARNING]  
> The service principal for `Azure CLI` may not exist in your tenant. If so, check [this issue](https://github.com/Azure/azure-cli/issues/28628) to add it.

> [!IMPORTANT]  
> `AllSites.Manage` is the minimum permission required to register a webhook.
> `Sites.Selected` cannot be used because it does not exist as a delegated permission in the SharePoint API.

## Grant the functions access to SharePoint when they run in Azure

`DefaultAzureCredential` will use a managed identity to authenticate to SharePoint. This may be the existing, system-assigned managed identity of the functions service, or a user-assigned managed identity.  
This tutorial will assume that the system-assigned managed identity is used.

### Grant SharePoint API permission Sites.Selected to the managed identity

Navigate to the [function apps in the Azure portal](https://portal.azure.com/#blade/HubsExtension/BrowseResourceBlade/resourceType/Microsoft.Web%2Fsites/kind/functionapp) > Select your app > Identity. Note the `Object (principal) ID` of the system-assigned managed identity.  
In this tutorial, it is `d3e8dc41-94f2-4b0f-82ff-ed03c363f0f8`.  
Then, use one of the scripts below to grant it the app-only permission `Sites.Selected` on the SharePoint API:

<details>
  <summary>Using Microsoft Graph PowerShell</summary>

```powershell
Connect-MgGraph -Scope "Application.Read.All", "AppRoleAssignment.ReadWrite.All"
$managedIdentityObjectId = "d3e8dc41-94f2-4b0f-82ff-ed03c363f0f8" # 'Object (principal) ID' of the managed identity
$scopeName = "Sites.Selected"
$resourceAppPrincipalObj = Get-MgServicePrincipal -Filter "displayName eq 'Office 365 SharePoint Online'" # SPO
$targetAppPrincipalAppRole = $resourceAppPrincipalObj.AppRoles | ? Value -eq $scopeName

$appRoleAssignment = @{
    "principalId" = $managedIdentityObjectId
    "resourceId"  = $resourceAppPrincipalObj.Id
    "appRoleId"   = $targetAppPrincipalAppRole.Id
}
New-MgServicePrincipalAppRoleAssignment -ServicePrincipalId $managedIdentityObjectId -BodyParameter $appRoleAssignment | Format-List
```

</details>
   
<details>
  <summary>Using az cli in Bash</summary>

```bash
managedIdentityObjectId="d3e8dc41-94f2-4b0f-82ff-ed03c363f0f8" # 'Object (principal) ID' of the managed identity
resourceServicePrincipalId=$(az ad sp list --query '[].[id]' --filter "displayName eq 'Office 365 SharePoint Online'" -o tsv)
resourceServicePrincipalAppRoleId="$(az ad sp show --id $resourceServicePrincipalId --query "appRoles[?starts_with(value, 'Sites.Selected')].[id]" -o tsv)"

az rest --method POST --uri "https://graph.microsoft.com/v1.0/servicePrincipals/${managedIdentityObjectId}/appRoleAssignments" --headers 'Content-Type=application/json' --body "{ 'principalId': '${managedIdentityObjectId}', 'resourceId': '${resourceServicePrincipalId}', 'appRoleId': '${resourceServicePrincipalAppRoleId}' }"
```

</details>

### Grant effective permission on a SharePoint site to the managed identity

Navigate to the [Enterprise applications in the Entra ID portal](https://entra.microsoft.com/#view/Microsoft_AAD_IAM/StartboardApplicationsMenuBlade/) > Set the filter `Application type` to `Managed Identities` > Click on your managed identity and note its `Application ID`.  
In this tutorial, it is `3150363e-afbe-421f-9785-9d5404c5ae34`.  

> [!WARNING]  
> In this step, we will use the `Application ID` of the managed identity, while in the previous step we used its `Object ID`, be mindful about the risk of confusion.

Then, use one of the scripts below to grant it the app-only permission `manage` on a specific SharePoint site:

<details>
  <summary>Using PnP PowerShell</summary>

[PnP PowerShell](https://pnp.github.io/powershell/cmdlets/Grant-PnPAzureADAppSitePermission.html)

```powershell
Connect-PnPOnline -Url "https://YOUR_SHAREPOINT_TENANT_PREFIX.sharepoint.com/sites/YOUR_SHAREPOINT_SITE_NAME" -Interactive -ClientId "YOUR_PNP_APP_CLIENT_ID"
Grant-PnPAzureADAppSitePermission -AppId "3150363e-afbe-421f-9785-9d5404c5ae34" -DisplayName "YOUR_FUNC_APP_NAME" -Permissions Manage
```

</details>
   
<details>
  <summary>Using m365 cli in Bash</summary>

[m365 cli](https://pnp.github.io/cli-microsoft365/cmd/spo/site/site-apppermission-add/)

```bash
targetapp="3150363e-afbe-421f-9785-9d5404c5ae34"
siteUrl="https://YOUR_SHAREPOINT_TENANT_PREFIX.sharepoint.com/sites/YOUR_SHAREPOINT_SITE_NAME"
m365 spo site apppermission add --appId $targetapp --permission manage --siteUrl $siteUrl
```

</details>

> [!IMPORTANT]  
> `manage` is the minimum permission required to register a webhook.
