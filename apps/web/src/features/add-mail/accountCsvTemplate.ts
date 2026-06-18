export const ACCOUNT_CSV_TEMPLATE = [
  "email,provider,display_name,auth_method,username,secret,imap_host,imap_port,imap_security,smtp_host,smtp_port,smtp_security,labels,group,enabled,notes",
  "support@qq.com,qq,Support,authorization_code,support@qq.com,mailbox-auth-code,,,,,,,support,team,true,Use mailbox authorization code",
  "archive@163.com,163,Archive,authorization_code,archive@163.com,mailbox-auth-code,,,,,,,archive,team,true,Use mailbox authorization code",
  "me@example.com,custom_domain,Domain mailbox,app_password,me@example.com,app-password,imap.example.com,993,tls,smtp.example.com,465,tls,personal,domain,true,Custom servers",
  "me@proton.me,proton_bridge,Proton Bridge,password,bridge-user,bridge-password,,,,,,,private,bridge,true,Keep Proton Bridge running",
].join("\n");
