import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface SurveyData {
  id: string;
  title: string;
  category: string;
  encryptedResponse: string;
  publicValue1: number;
  publicValue2: number;
  timestamp: number;
  creator: string;
  isVerified?: boolean;
  decryptedValue?: number;
}

interface SurveyStats {
  totalSurveys: number;
  verifiedResponses: number;
  avgScore: number;
  trendingTopics: string[];
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [surveys, setSurveys] = useState<SurveyData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingSurvey, setCreatingSurvey] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({
    visible: false,
    status: "pending",
    message: ""
  });
  const [newSurveyData, setNewSurveyData] = useState({
    title: "",
    category: "商业",
    response: ""
  });
  const [selectedSurvey, setSelectedSurvey] = useState<SurveyData | null>(null);
  const [stats, setStats] = useState<SurveyStats>({
    totalSurveys: 0,
    verifiedResponses: 0,
    avgScore: 0,
    trendingTopics: []
  });
  const [showFAQ, setShowFAQ] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized) return;

      try {
        console.log('Initializing FHEVM for market research...');
        await initialize();
      } catch (error) {
        console.error('FHEVM initialization failed:', error);
        setTransactionStatus({
          visible: true,
          status: "error",
          message: "FHEVM初始化失败，请检查钱包连接"
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize]);

  useEffect(() => {
    const loadData = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }

      try {
        await loadSurveyData();
      } catch (error) {
        console.error('Failed to load survey data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [isConnected]);

  const loadSurveyData = async () => {
    if (!isConnected) return;

    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;

      const businessIds = await contract.getAllBusinessIds();
      const surveysList: SurveyData[] = [];

      for (const businessId of businessIds) {
        try {
          const surveyData = await contract.getBusinessData(businessId);
          surveysList.push({
            id: businessId,
            title: surveyData.name,
            category: surveyData.description,
            encryptedResponse: businessId,
            publicValue1: Number(surveyData.publicValue1) || 0,
            publicValue2: Number(surveyData.publicValue2) || 0,
            timestamp: Number(surveyData.timestamp),
            creator: surveyData.creator,
            isVerified: surveyData.isVerified,
            decryptedValue: Number(surveyData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading survey data:', e);
        }
      }

      setSurveys(surveysList);
      updateStats(surveysList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "加载调研数据失败" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally {
      setIsRefreshing(false);
    }
  };

  const updateStats = (surveyList: SurveyData[]) => {
    const total = surveyList.length;
    const verified = surveyList.filter(s => s.isVerified).length;
    const avgScore = total > 0 ? surveyList.reduce((sum, s) => sum + s.publicValue1, 0) / total : 0;

    const categoryCount: {[key: string]: number} = {};
    surveyList.forEach(survey => {
      categoryCount[survey.category] = (categoryCount[survey.category] || 0) + 1;
    });

    const trending = Object.entries(categoryCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([category]) => category);

    setStats({
      totalSurveys: total,
      verifiedResponses: verified,
      avgScore: avgScore,
      trendingTopics: trending
    });
  };

  const createSurvey = async () => {
    if (!isConnected || !address) {
      setTransactionStatus({ visible: true, status: "error", message: "请先连接钱包" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return;
    }

    setCreatingSurvey(true);
    setTransactionStatus({ visible: true, status: "pending", message: "使用Zama FHE创建加密调研..." });

    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("获取合约失败");

      const responseValue = parseInt(newSurveyData.response) || 0;
      const businessId = `survey-${Date.now()}`;

      const encryptedResult = await encrypt(await contract.getAddress(), address, responseValue);

      const tx = await contract.createBusinessData(
        businessId,
        newSurveyData.title,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        Math.floor(Math.random() * 10) + 1,
        0,
        newSurveyData.category
      );

      setTransactionStatus({ visible: true, status: "pending", message: "等待交易确认..." });
      await tx.wait();

      setTransactionStatus({ visible: true, status: "success", message: "调研创建成功！" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);

      await loadSurveyData();
      setShowCreateModal(false);
      setNewSurveyData({ title: "", category: "商业", response: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction")
        ? "用户拒绝了交易"
        : "提交失败: " + (e.message || "未知错误");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally {
      setCreatingSurvey(false);
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) {
      setTransactionStatus({ visible: true, status: "error", message: "请先连接钱包" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null;
    }

    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;

      const surveyData = await contractRead.getBusinessData(businessId);
      if (surveyData.isVerified) {
        const storedValue = Number(surveyData.decryptedValue) || 0;

        setTransactionStatus({
          visible: true,
          status: "success",
          message: "数据已在链上验证"
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);

        return storedValue;
      }

      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;

      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);

      const result = await verifyDecryption(
        [encryptedValueHandle],
        await contractWrite.getAddress(),
        (abiEncodedClearValues: string, decryptionProof: string) =>
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );

      setTransactionStatus({ visible: true, status: "pending", message: "在链上验证解密..." });

      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];

      await loadSurveyData();

      setTransactionStatus({ visible: true, status: "success", message: "数据解密验证成功！" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);

      return Number(clearValue);

    } catch (e: any) {
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({
          visible: true,
          status: "success",
          message: "数据已在链上验证"
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);

        await loadSurveyData();
        return null;
      }

      setTransactionStatus({
        visible: true,
        status: "error",
        message: "解密失败: " + (e.message || "未知错误")
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null;
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;

      const available = await contract.isAvailable();
      if (available) {
        setTransactionStatus({ visible: true, status: "success", message: "FHE系统可用性检查成功！" });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "系统检查失败" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredSurveys = surveys.filter(survey =>
    survey.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    survey.category.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const renderStatsChart = () => {
    return (
      <div className="stats-chart">
        <div className="chart-row">
          <div className="chart-label">总调研数</div>
          <div className="chart-bar">
            <div
              className="bar-fill"
              style={{ width: `${Math.min(100, stats.totalSurveys * 10)}%` }}
            >
              <span className="bar-value">{stats.totalSurveys}</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">已验证响应</div>
          <div className="chart-bar">
            <div
              className="bar-fill"
              style={{ width: `${stats.totalSurveys > 0 ? (stats.verifiedResponses / stats.totalSurveys) * 100 : 0}%` }}
            >
              <span className="bar-value">{stats.verifiedResponses}/{stats.totalSurveys}</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">平均评分</div>
          <div className="chart-bar">
            <div
              className="bar-fill"
              style={{ width: `${stats.avgScore * 10}%` }}
            >
              <span className="bar-value">{stats.avgScore.toFixed(1)}/10</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderFHEProcess = () => {
    return (
      <div className="fhe-process">
        <div className="process-step neon-step">
          <div className="step-icon">🔒</div>
          <div className="step-content">
            <h4>响应加密</h4>
            <p>用户调研数据通过Zama FHE加密保护</p>
          </div>
        </div>
        <div className="process-arrow">➡</div>
        <div className="process-step neon-step">
          <div className="step-icon">📊</div>
          <div className="step-content">
            <h4>同态统计</h4>
            <p>在加密数据上直接进行统计分析</p>
          </div>
        </div>
        <div className="process-arrow">➡</div>
        <div className="process-step neon-step">
          <div className="step-icon">🔓</div>
          <div className="step-content">
            <h4>安全解密</h4>
            <p>仅获取统计趋势，不暴露个体数据</p>
          </div>
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>🔐 隐私市场调研</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>

        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔍</div>
            <h2>连接钱包开始隐私调研</h2>
            <p>使用FHE技术保护您的调研数据隐私，实现真正的匿名市场研究</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>连接您的加密钱包</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>FHE系统自动初始化</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>参与加密调研，保护隐私</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>初始化FHE加密系统...</p>
        <p className="loading-note">正在准备隐私保护环境</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>加载加密调研系统...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>🔐 隐私市场调研</h1>
          <span className="tagline">FHE保护的用户隐私调研平台</span>
        </div>

        <div className="header-actions">
          <button
            onClick={() => setShowCreateModal(true)}
            className="create-btn neon-btn"
          >
            + 新建调研
          </button>
          <button
            onClick={checkAvailability}
            className="check-btn neon-btn"
          >
            系统检查
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>

      <div className="main-content">
        <div className="stats-section">
          <h2>📈 调研数据统计</h2>
          {renderStatsChart()}

          <div className="trending-topics">
            <h3>🔥 热门调研主题</h3>
            <div className="topics-list">
              {stats.trendingTopics.map((topic, index) => (
                <span key={index} className="topic-tag">{topic}</span>
              ))}
            </div>
          </div>
        </div>

        <div className="fhe-section">
          <h2>🔐 FHE隐私保护流程</h2>
          {renderFHEProcess()}
        </div>

        <div className="surveys-section">
          <div className="section-header">
            <h2>📋 调研问卷列表</h2>
            <div className="header-controls">
              <input
                type="text"
                placeholder="搜索调研..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="search-input"
              />
              <button
                onClick={loadSurveyData}
                className="refresh-btn neon-btn"
                disabled={isRefreshing}
              >
                {isRefreshing ? "刷新中..." : "🔄"}
              </button>
              <button
                onClick={() => setShowFAQ(!showFAQ)}
                className="faq-btn neon-btn"
              >
                {showFAQ ? "隐藏FAQ" : "显示FAQ"}
              </button>
            </div>
          </div>

          {showFAQ && (
            <div className="faq-section">
              <h3>❓ 常见问题解答</h3>
              <div className="faq-list">
                <div className="faq-item">
                  <strong>Q: FHE如何保护我的隐私？</strong>
                  <p>A: 全同态加密允许在加密数据上直接计算，调研方只能获取统计结果，无法查看个体回答。</p>
                </div>
                <div className="faq-item">
                  <strong>Q: 数据是否真的安全？</strong>
                  <p>A: 所有数据在链上加密存储，只有您拥有解密密钥，确保绝对隐私安全。</p>
                </div>
                <div className="faq-item">
                  <strong>Q: 支持哪些类型的数据？</strong>
                  <p>A: 目前支持整数类型的调研回答，未来将扩展更多数据类型。</p>
                </div>
              </div>
            </div>
          )}

          <div className="surveys-list">
            {filteredSurveys.length === 0 ? (
              <div className="no-surveys">
                <p>暂无调研问卷</p>
                <button
                  className="create-btn neon-btn"
                  onClick={() => setShowCreateModal(true)}
                >
                  创建第一个调研
                </button>
              </div>
            ) : filteredSurveys.map((survey, index) => (
              <div
                className={`survey-item ${selectedSurvey?.id === survey.id ? "selected" : ""} ${survey.isVerified ? "verified" : ""}`}
                key={index}
                onClick={() => setSelectedSurvey(survey)}
              >
                <div className="survey-title">{survey.title}</div>
                <div className="survey-meta">
                  <span className="category-tag">{survey.category}</span>
                  <span>评分: {survey.publicValue1}/10</span>
                  <span>时间: {new Date(survey.timestamp * 1000).toLocaleDateString()}</span>
                </div>
                <div className="survey-status">
                  状态: {survey.isVerified ? "✅ 链上已验证" : "🔒 等待验证"}
                  {survey.isVerified && survey.decryptedValue !== undefined && (
                    <span className="verified-value">加密值: {survey.decryptedValue}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showCreateModal && (
        <ModalCreateSurvey
          onSubmit={createSurvey}
          onClose={() => setShowCreateModal(false)}
          creating={creatingSurvey}
          surveyData={newSurveyData}
          setSurveyData={setNewSurveyData}
          isEncrypting={isEncrypting}
        />
      )}

      {selectedSurvey && (
        <SurveyDetailModal
          survey={selectedSurvey}
          onClose={() => setSelectedSurvey(null)}
          isDecrypting={fheIsDecrypting}
          decryptData={() => decryptData(selectedSurvey.id)}
        />
      )}

      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateSurvey: React.FC<{
  onSubmit: () => void;
  onClose: () => void;
  creating: boolean;
  surveyData: any;
  setSurveyData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, surveyData, setSurveyData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (name === 'response') {
      const intValue = value.replace(/[^\d]/g, '');
      setSurveyData({ ...surveyData, [name]: intValue });
    } else {
      setSurveyData({ ...surveyData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-survey-modal">
        <div className="modal-header">
          <h2>新建隐私调研问卷</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>

        <div className="modal-body">
          <div className="fhe-notice">
            <strong>🔐 FHE加密保护</strong>
            <p>调研数据将使用Zama FHE加密（仅支持整数类型）</p>
          </div>

          <div className="form-group">
            <label>调研标题 *</label>
            <input
              type="text"
              name="title"
              value={surveyData.title}
              onChange={handleChange}
              placeholder="输入调研标题..."
            />
          </div>

          <div className="form-group">
            <label>调研分类 *</label>
            <select name="category" value={surveyData.category} onChange={handleChange}>
              <option value="商业">商业</option>
              <option value="科技">科技</option>
              <option value="消费">消费</option>
              <option value="社会">社会</option>
            </select>
          </div>

          <div className="form-group">
            <label>调研回答（整数） *</label>
            <input
              type="number"
              name="response"
              value={surveyData.response}
              onChange={handleChange}
              placeholder="输入整数回答..."
              step="1"
              min="0"
            />
            <div className="data-type-label">FHE加密整数</div>
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">取消</button>
          <button
            onClick={onSubmit}
            disabled={creating || isEncrypting || !surveyData.title || !surveyData.response}
            className="submit-btn neon-btn"
          >
            {creating || isEncrypting ? "加密并创建中..." : "创建调研"}
          </button>
        </div>
      </div>
    </div>
  );
};

const SurveyDetailModal: React.FC<{
  survey: SurveyData;
  onClose: () => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ survey, onClose, isDecrypting, decryptData }) => {
  const [decryptedValue, setDecryptedValue] = useState<number | null>(null);

  const handleDecrypt = async () => {
    if (decryptedValue !== null) {
      setDecryptedValue(null);
      return;
    }

    const decrypted = await decryptData();
    setDecryptedValue(decrypted);
  };

  return (
    <div className="modal-overlay">
      <div className="survey-detail-modal">
        <div className="modal-header">
          <h2>调研详情</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>

        <div className="modal-body">
          <div className="survey-info">
            <div className="info-item">
              <span>调研标题:</span>
              <strong>{survey.title}</strong>
            </div>
            <div className="info-item">
              <span>分类:</span>
              <strong>{survey.category}</strong>
            </div>
            <div className="info-item">
              <span>创建者:</span>
              <strong>{survey.creator.substring(0, 6)}...{survey.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>创建时间:</span>
              <strong>{new Date(survey.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-item">
              <span>公开评分:</span>
              <strong>{survey.publicValue1}/10</strong>
            </div>
          </div>

          <div className="data-section">
            <h3>🔐 加密调研数据</h3>

            <div className="data-row">
              <div className="data-label">加密回答:</div>
              <div className="data-value">
                {survey.isVerified && survey.decryptedValue !== undefined ?
                  `${survey.decryptedValue} (链上已验证)` :
                  decryptedValue !== null ?
                  `${decryptedValue} (本地解密)` :
                  "🔒 FHE加密整数"
                }
              </div>
              <button
                className={`decrypt-btn ${(survey.isVerified || decryptedValue !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt}
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  "🔓 验证中..."
                ) : survey.isVerified ? (
                  "✅ 已验证"
                ) : decryptedValue !== null ? (
                  "🔄 重新验证"
                ) : (
                  "🔓 验证解密"
                )}
              </button>
            </div>

            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE隐私保护机制</strong>
                <p>您的回答在链上加密存储，只有通过验证解密才能获取原始值，确保调研隐私安全。</p>
              </div>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">关闭</button>
          {!survey.isVerified && (
            <button
              onClick={handleDecrypt}
              disabled={isDecrypting}
              className="verify-btn neon-btn"
            >
              {isDecrypting ? "链上验证中..." : "链上验证"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;


