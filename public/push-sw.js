const APP_URL='/tracker.html';
self.addEventListener('push',event=>{
  const data=event.data?.json?.()||{};
  const title=data.title||'ARCO — New order';
  const options={body:data.body||'A new non-draft order was created.',icon:data.icon||'https://pub-afe21e63db9948a78cf5b43bfa17bcb8.r2.dev/app-icon.png',badge:data.badge||'https://pub-afe21e63db9948a78cf5b43bfa17bcb8.r2.dev/exec-200b409c-40d2-49a0-a930-b2e9da4d6862.png',tag:data.tag||'arco-new-order',renotify:true,silent:false,requireInteraction:true,data:{url:data.url||APP_URL}};
  event.waitUntil(self.registration.showNotification(title,options));
});
self.addEventListener('notificationclick',event=>{event.notification.close();const url=event.notification.data?.url||APP_URL;event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{for(const client of list){if('focus' in client){client.navigate(url);return client.focus()}}return clients.openWindow(url)}));});
