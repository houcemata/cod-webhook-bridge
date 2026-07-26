const APP_URL='/tracker.html';
self.addEventListener('push',event=>{
  const data=event.data?.json?.()||{};
  const title=data.title||'ARCO — New order';
  const options={body:data.body||'A new non-draft order was created.',icon:data.icon||'/arco-icon.svg',badge:data.badge||'/arco-badge.svg',tag:data.tag||'arco-new-order',renotify:true,silent:false,requireInteraction:true,data:{url:data.url||APP_URL}};
  event.waitUntil(self.registration.showNotification(title,options));
});
self.addEventListener('notificationclick',event=>{event.notification.close();const url=event.notification.data?.url||APP_URL;event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{for(const client of list){if('focus' in client){client.navigate(url);return client.focus()}}return clients.openWindow(url)}));});
