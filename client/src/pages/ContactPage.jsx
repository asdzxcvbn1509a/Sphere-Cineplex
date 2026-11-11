import { useI18n } from '../context/I18nContext.jsx';
import Breadcrumb from '../components/ui/Breadcrumb.jsx';
import {
  FacebookLogo,
  InstagramLogo,
  LineLogo,
  TiktokLogo,
  XLogo,
  YoutubeLogo,
} from '../components/ui/SocialIcons.jsx';

/*
  ช่องทางติดต่อของโรง — ยังไม่มีบัญชีจริง ลิงก์จึงชี้หน้าแรกของแต่ละแพลตฟอร์มไว้ก่อน มีเพจจริงเมื่อไหร่แก้ href ที่นี่ที่เดียว
  ชื่อแบรนด์เหมือนกันทุกภาษา จึงไม่อยู่ในไฟล์ i18n
*/
const SOCIAL_LINKS = [
  { id: 'facebook', label: 'Facebook', href: 'https://www.facebook.com/', Icon: FacebookLogo },
  { id: 'line', label: 'LINE', href: 'https://line.me/', Icon: LineLogo },
  { id: 'tiktok', label: 'TikTok', href: 'https://www.tiktok.com/', Icon: TiktokLogo },
  { id: 'instagram', label: 'Instagram', href: 'https://www.instagram.com/', Icon: InstagramLogo },
  { id: 'x', label: 'X', href: 'https://x.com/', Icon: XLogo },
  { id: 'youtube', label: 'YouTube', href: 'https://www.youtube.com/', Icon: YoutubeLogo },
];

const ContactPage = () => {
  const { t } = useI18n();

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <Breadcrumb
        className="mb-4"
        items={[{ label: t('nav.home'), to: '/' }, { label: t('nav.contact') }]}
      />
      <h1 className="mb-1 text-h1 font-bold">{t('contact.title')}</h1>
      <p className="mb-6 text-body-2 text-muted sm:text-body-1">{t('contact.subtitle')}</p>

      {/*
        -mx เท่ากับ padding ของลิงก์ กรอบไอคอนแรกจึงเริ่มตรงกับหัวข้อ
        มือถือไอคอน 40px (พื้นที่แตะ 52px) หกอันยังเรียงแถวเดียวได้ที่จอกว้าง 360px
      */}
      <ul aria-label={t('contact.channels')} className="-mx-1.5 flex flex-wrap items-center gap-1 sm:-mx-2">
        {SOCIAL_LINKS.map(({ id, label, href, Icon }) => (
          <li key={id}>
            {/* เปิดแท็บใหม่ — คนที่จองค้างไว้จะไม่หลุดออกจากหน้าเว็บ */}
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={label}
              title={label}
              className="block rounded-xl p-1.5 text-gold-50 transition hover:bg-fg/8 hover:text-gold-30 sm:p-2"
            >
              <Icon className="size-10 sm:size-16" />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default ContactPage;
