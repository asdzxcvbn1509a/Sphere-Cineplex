import { useI18n } from '../../context/I18nContext.jsx';
import { BANKS, OTHER_BANK } from '../../utils/banks.js';
import Field from '../ui/Field.jsx';
import Input from '../ui/Input.jsx';
import Select from '../ui/Select.jsx';

/**
 * ช่องเลือกธนาคาร + เลขที่บัญชีสำหรับรับเงินคืน
 * ใช้ทั้งตอนยกเลิกใบที่จ่ายแล้ว และตอนแจ้ง/แก้บัญชีภายหลัง (เช่น ผู้ดูแลยกเลิกรอบแทน)
 * ตรวจค่าด้วย readRefundAccountForm ใน utils/banks.js
 */
const RefundAccountFields = ({ form, onChange, errors = {} }) => {
  const { t, lang } = useI18n();
  const setField = (key) => (event) => onChange({ ...form, [key]: event.target.value });

  return (
    <>
      <Field label={t('bookings.bankName')} required error={errors.bank}>
        <Select value={form.bankCode} onChange={setField('bankCode')}>
          <option value="">{t('bookings.bankPlaceholder')}</option>
          {BANKS.map((bank) => (
            <option key={bank.code} value={bank.code}>
              {lang === 'en' ? bank.en : bank.th}
            </option>
          ))}
          <option value={OTHER_BANK}>{t('bookings.bankOther')}</option>
        </Select>
      </Field>

      {form.bankCode === OTHER_BANK && (
        <Field label={t('bookings.bankNameCustom')} required>
          <Input value={form.customBank} maxLength={60} onChange={setField('customBank')} />
        </Field>
      )}

      <Field
        label={t('bookings.accountNo')}
        required
        hint={t('bookings.accountNoHint')}
        error={errors.accountNo}
      >
        <Input
          value={form.accountNo}
          inputMode="numeric"
          maxLength={20}
          placeholder="1234567890"
          onChange={setField('accountNo')}
        />
      </Field>
    </>
  );
};

export default RefundAccountFields;
