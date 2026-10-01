import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import clsx from 'clsx';
import { useI18n } from '../../context/I18nContext.jsx';
import Input from './Input.jsx';

/**
 * ช่องรหัสผ่านพร้อมปุ่มสลับแสดง/ซ่อน
 *
 * การให้ผู้ใช้เห็นสิ่งที่พิมพ์ได้ช่วยลดการพิมพ์ผิดบนมือถือมาก
 * โดยเฉพาะตอนสมัครที่ต้องกรอกรหัสเดิมซ้ำสองช่อง
 */
const PasswordInput = ({ className, ...props }) => {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);

  return (
    <span className="relative block">
      <Input
        {...props}
        type={visible ? 'text' : 'password'}
        className={clsx('pr-11', className)}
      />
      <button
        type="button"
        onClick={() => setVisible((value) => !value)}
        // กัน input เสียโฟกัสตอนกดปุ่ม ผู้ใช้จะได้พิมพ์ต่อได้เลย
        onMouseDown={(event) => event.preventDefault()}
        className="absolute right-1 top-1/2 -translate-y-1/2 rounded-lg p-2 text-muted transition hover:text-fg"
        aria-label={visible ? t('login.hidePassword') : t('login.showPassword')}
        title={visible ? t('login.hidePassword') : t('login.showPassword')}
      >
        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </span>
  );
};

export default PasswordInput;
