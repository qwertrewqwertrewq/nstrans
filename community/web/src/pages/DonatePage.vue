<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import PageHeader from '../components/PageHeader.vue'
import { copyText } from '../services/api'
const active = ref('wechat'),
  address = '0x28A7c91331314960FD8Bbc2111Ef6F99e728754e'
async function copy() {
  try {
    await copyText(address)
    ElMessage.success('地址已复制')
  } catch {
    ElMessage.error('无法自动复制，请手动选择地址复制')
  }
}
</script>
<template>
  <div class="page-stack">
    <PageHeader
      eyebrow="SUPPORT"
      title="支持 NSTrans"
      description="喜欢这个项目，可以点一颗 Star，也可以自愿捐赠。感谢你帮助项目持续维护。"
    >
      <a href="https://github.com/qwertrewqwertrewq/nstrans" target="_blank" rel="noreferrer">
        <el-button type="primary">GitHub · Star ↗</el-button>
      </a>
    </PageHeader>
    <el-tabs v-model="active" class="donate-tabs">
      <el-tab-pane label="微信" name="wechat" />
      <el-tab-pane label="支付宝" name="alipay" />
      <el-tab-pane label="链上转账" name="crypto" />
    </el-tabs>
    <div class="donate-grid">
      <el-card class="donate-card" :class="{ 'donate-active': active === 'wechat' }" shadow="never">
        <img src="/donate-assets/wechat.jpg" alt="微信收款二维码" class="payment-image" />
      </el-card>
      <el-card class="donate-card" :class="{ 'donate-active': active === 'alipay' }" shadow="never">
        <img src="/donate-assets/alipay.png" alt="支付宝收款二维码" class="payment-image" />
      </el-card>
      <el-card class="donate-card" :class="{ 'donate-active': active === 'crypto' }" shadow="never">
        <h2>链上转账</h2>
        <img src="/donate-assets/evm-address.svg" alt="EVM 收款地址二维码" class="crypto-qr" />
        <div class="network-tags">
          <el-tag type="success">Arbitrum · 推荐</el-tag>
          <el-tag type="success">Polygon / POL · 推荐</el-tag>
          <el-tag type="info">BNB Chain</el-tag>
          <el-tag type="info">Ethereum / ERC20</el-tag>
        </div>
        <code class="wallet-address">{{ address }}</code>
        <el-button type="primary" @click="copy">复制地址</el-button>
        <p class="muted">
          以上网络共用此地址。二维码仅包含地址，请在钱包中核对网络与币种；链上转账不可撤销。
        </p>
      </el-card>
    </div>
  </div>
</template>
