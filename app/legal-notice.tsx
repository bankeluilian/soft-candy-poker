export const TERMS_VERSION = "2026-09-11.1";
export const TERMS_STORAGE_KEY = "poker-terms-acceptance";

export function hasAcceptedTerms(raw: string | null) {
  try {
    const record = JSON.parse(raw || "null");
    return record?.version === TERMS_VERSION && record?.accepted === true && typeof record.acceptedAt === "number" && Number.isFinite(record.acceptedAt) && record.acceptedAt > 0;
  } catch { return false; }
}

export function createTermsAcceptance(checked: boolean, now = Date.now()) {
  if (!checked) throw new Error("请先阅读并同意使用规则");
  return { version: TERMS_VERSION, accepted: true, acceptedAt: now };
}

export function LegalNotice() {
  return <div className="legal-notice">
    <p className="legal-version">适用范围：中国大陆 · 更新日期：2026 年 9 月 11 日</p>
    <div className="legal-important"><strong>仅供娱乐，严禁赌博</strong><p>请特别阅读下列用途限制和责任说明。不同意本规则，请勿进入或继续使用。</p></div>
    <section><h3>1. 娱乐用途与虚拟筹码</h3><p>软糖扑克仅用于休闲娱乐和规则学习，不提供真实资金投注、充值、提现、转账或实物兑换。筹码仅为游戏内积分，不作为现实财产或交易凭证，不得出售、兑换或用作赌资。</p></section>
    <section><h3>2. 明确禁止的行为</h3><p>不得利用本应用组织、参与、招揽或推广赌博；不得将筹码、牌局输赢或战绩与现金、实物、数字资产及其他有价利益挂钩，在线上或线下进行投注、结算、抽成、代收代付。不得将本应用改造、转售或提供给他人用于上述违法活动。</p></section>
    <section className="legal-important"><h3>3. 用户责任与免责边界</h3><p>用户违反本规则、擅自将本应用用于赌博或其他违法活动的，应依法承担与其行为相应的法律责任。开发者及运营者未授权任何赌博用途，亦不承诺承担用户自行实施违法行为产生的损失。</p><p><strong>本声明不免除开发者、运营者依法应承担的责任，也不限制用户依法享有的权利。</strong>责任应根据实际行为、过错及法律规定认定，不能仅凭用户同意或本声明转移。涉及人身损害，或故意、重大过失造成财产损失等依法不能免责的情况，不适用免责约定。</p></section>
    <section><h3>4. 使用确认与规则更新</h3><p>勾选确认并点击“同意规则并进入”，表示你已阅读并同意在合法娱乐范围内使用本应用。继续使用期间同样应遵守上述规则；沉默、未勾选或仅浏览本说明不视为同意。重要规则变更后将重新提示确认。</p><p>请合理安排娱乐时间。不理解条款时，请先停止使用并咨询专业人士。</p></section>
    <section><h3>5. 法律依据</h3><p>赌博、开设赌场等行为可能受到行政处罚或刑事追究；格式条款的提示说明义务和免责效力受法律约束。下列链接供查阅，本说明不构成对具体使用方式合法性的保证。</p>
      <ul>
        <li><a href="https://jtgl.beijing.gov.cn/jgj/jgxx/flfg/fl/11033925/index.html" target="_blank" rel="noreferrer">《中华人民共和国刑法》第 303 条</a></li>
        <li><a href="https://www.npc.gov.cn/npc/c2/c30834/202506/t20250627_446254.html" target="_blank" rel="noreferrer">《中华人民共和国治安管理处罚法》第 82 条（2026 年 1 月 1 日起施行）</a></li>
        <li><a href="https://www.spp.gov.cn/zdgz/202006/t20200602_463886.shtml" target="_blank" rel="noreferrer">《中华人民共和国民法典》第 496、497、506 条</a></li>
      </ul>
    </section>
  </div>;
}
