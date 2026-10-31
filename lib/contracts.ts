import { z } from 'zod';
export const ticketInput = z.object({title:z.string().trim().min(1).max(100),category:z.enum(['hardware','networks','software','accounts']),location:z.string().trim().min(1).max(90),description:z.string().trim().min(1).max(2500),contact:z.object({building:z.string().trim().min(1).max(60),department:z.string().trim().min(1).max(60),floor:z.string().trim().min(1).max(30),office:z.string().trim().min(1).max(30),phone:z.string().regex(/^(?:05[0-9]{8}|\+9665[0-9]{8}|009665[0-9]{8}|\+[1-9][0-9]{7,14})$/)}).strict().optional(),requestId:z.string().uuid()}).strict();
export const manualPriorityInput=z.object({priority:z.enum(['high','medium','low']),reason:z.string().trim().min(5).max(800)}).strict();
export const actionInput=z.discriminatedUnion('action',[
 z.object({action:z.literal('note'),text:z.string().trim().min(1).max(2000)}).strict(),
 z.object({action:z.literal('claim')}).strict(),z.object({action:z.literal('close')}).strict(),
 z.object({action:z.literal('add_task'),text:z.string().trim().min(1).max(180)}).strict(),
 z.object({action:z.literal('set_task'),task_id:z.string().uuid(),done:z.boolean()}).strict(),
 z.object({action:z.literal('draft'),recipient_id:z.string().uuid().nullable(),reason:z.enum(['shift_end','specialization','workload']),summary:z.string().max(4000),notes:z.string().max(2500)}).strict(),
 z.object({action:z.literal('send'),recipient_id:z.string().uuid(),reason:z.enum(['shift_end','specialization','workload']),summary:z.string().trim().min(1).max(4000),notes:z.string().max(2500)}).strict(),
 z.object({action:z.literal('accept'),handover_id:z.string().uuid(),acknowledged:z.literal(true)}).strict(),
 z.object({action:z.literal('decline'),handover_id:z.string().uuid(),reason:z.string().trim().min(1).max(2000)}).strict()
]);
export const errors:Record<string,string>={PRIORITY_REVIEW_REQUIRED:'تحديد الأولوية يدويًا متاح فقط للبلاغات التي تحتاج مراجعة فني.',AUTH_REQUIRED:'سجّل الدخول للمتابعة.',NOT_ALLOWED:'لا تملك صلاحية الوصول لهذا البلاغ.',TECH_REQUIRED:'هذه العملية مخصصة للفنيين المعتمدين.',OWNER_REQUIRED:'هذه العملية متاحة للفني المسؤول فقط.',NOT_RECIPIENT:'قبول أو رفض التسليم متاح للفني المستلم فقط.',ADMIN_REQUIRED:'هذه العملية تحتاج صلاحية المسؤول.',CONFLICT:'تغيّرت حالة البلاغ. حدّث الصفحة وحاول مرة أخرى.',INVALID_INPUT:'تحقق من البيانات المطلوبة.',INVALID_RECIPIENT:'اختر فنيًا معتمدًا آخر.',REASON_REQUIRED:'اكتب سبب الرفض.',REVIEW_REQUIRED:'راجع التفاصيل وأكّد استعدادك للاستلام.',HANDOVER_PENDING:'يوجد طلب تسليم معلّق. احسم الطلب أولًا.',TASKS_REMAIN:'أكمل الخطوات المتبقية قبل إغلاق البلاغ.',TICKET_CLOSED:'البلاغ مغلق.',AI_BUSY:'يجري تحليل البلاغ الآن. أعد التحديث بعد قليل.',RATE_LIMIT:'وصلت إلى حد المحاولات. انتظر قليلًا ثم أعد المحاولة.',NOT_FOUND:'العنصر المطلوب غير موجود.'};
